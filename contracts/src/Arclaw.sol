// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IPriceSource} from "./interfaces/IPriceSource.sol";
import {IAstockDesk} from "./interfaces/IAstock.sol";
import {D20Randomness} from "./vrf/D20Randomness.sol";

/// @title Arclaw: claw machines that pay sealed packs of tokenized stock on Arc
/// @notice Each machine is an ERC-1155 id with its own price. Pay the price in native USDC (18 dp) per play, get one
///         sealed box of that machine. Opening burns boxes and asks the VRF for one word; once it lands anyone can
///         `reveal`, which draws ONE weighted outcome per box (a pack of 3 cards) from the machine's table frozen at
///         open time and pays the cards from inventory. A card the inventory cannot cover is refunded at its value,
///         fixed in USDC when the table was set.
///         Every table, whoever sets it, must satisfy the machine's rules: each outcome worth at least floorBps and
///         at most capBps of the price, and the weighted expected value inside [rtpMinBps, rtpMaxBps].
contract Arclaw is ERC1155, Ownable2Step, Pausable, ReentrancyGuard, EIP712, D20Randomness {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants

    uint256 public constant CARDS_PER_BOX = 3;
    uint256 public constant MAX_BOXES_PER_OPEN = 20;
    uint32 public constant MIN_CALLBACK_GAS = 30_000; // D20 bounds
    uint32 public constant MAX_CALLBACK_GAS = 1_000_000;
    /// Sanity bounds on the owner's per-machine rules.
    uint16 public constant MIN_FLOOR_BPS = 3000; // never less than 30% back
    uint16 public constant MAX_RTP_BPS = 9500; // house edge never under 5%
    uint32 public constant MAX_CAP_BPS = 1_000_000; // 100x
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(uint256 linkId,address recipient)");

    // ------------------------------------------------------------------ types

    struct Machine {
        uint128 price; // native USDC, 18 dp; 0 = not playable
        uint16 floorBps; // min outcome value / price
        uint32 capBps; // max outcome value / price
        uint16 rtpMinBps; // expected value band / price
        uint16 rtpMaxBps;
    }

    /// Operator/owner input: one outcome = one pack.
    struct OutcomeInput {
        uint88 weight;
        uint8 tier;
        address[3] tokens;
        uint256[3] amounts;
    }

    struct Card {
        address token;
        uint96 value; // USDC 18 dp, priced when the table was set; the shortfall refund
        uint256 amount;
    }

    struct Outcome {
        uint88 weight;
        uint8 tier;
        uint128 value; // sum of card values
        Card[3] cards;
    }

    enum OpeningStatus {
        None,
        Pending,
        Fulfilled,
        Revealed,
        Returned
    }

    struct Opening {
        address opener;
        uint32 boxes;
        uint32 tableId;
        uint16 machineId;
        OpeningStatus status;
        uint64 requestedAt;
        uint256 requestId;
        bytes32 word;
    }

    enum LinkStatus {
        None,
        Open,
        Claimed,
        Reclaimed
    }

    struct Link {
        address sender;
        uint32 boxes;
        uint16 machineId;
        uint40 expiresAt;
        LinkStatus status;
        address linkKey;
    }

    // ------------------------------------------------------------------ storage

    mapping(uint256 => Machine) public machines;
    uint256[] internal _machineIds;
    /// machineId => current tableId + 1
    mapping(uint256 => uint256) public currentTable;

    /// Append-only table history; an opening draws from the table current when it opened.
    Outcome[][] internal _tables;
    uint256[] public tableWeight;
    uint256[] public tableMachine;

    mapping(uint256 => Opening) public openings;
    /// requestId => openingId + 1 (0 = unknown or superseded)
    mapping(uint256 => uint256) public openingOfRequest;
    uint256 public nextOpeningId;

    mapping(uint256 => Link) public links;
    mapping(address => bool) public linkKeyUsed;
    uint256 public nextLinkId;
    /// machineId => boxes held in link escrow (== balanceOf(this, machineId))
    mapping(uint256 => uint256) public escrowed;

    mapping(address => uint256) public credit;

    uint32 public callbackGasLimit = 100_000;
    uint256 public maxVrfSubsidy;

    // Lifetime totals
    mapping(uint256 => uint256) public boxesSold; // per machine
    uint256 public boxesOpened;
    uint256 public cardsPaid;
    uint256 public cardsRefunded;
    uint256 public vrfFeesPaid;
    mapping(address => uint256) public paidOut;

    // Treasury policy
    address public operator;
    IPriceSource public priceSource;
    mapping(address => bool) public sinks;
    uint256 public dailyCap;
    uint256 public spentDay;
    uint256 public spentToday;

    // ------------------------------------------------------------------ events

    event Played(address indexed player, uint256 indexed machineId, uint256 boxes, uint256 paid);
    event Gifted(address indexed from, address indexed to, uint256 indexed machineId, uint256 boxes);
    event Opened(
        uint256 indexed openingId,
        uint256 indexed requestId,
        address indexed opener,
        uint256 machineId,
        uint256 boxes,
        uint256 tableId,
        uint256 vrfFee
    );
    event Rerequested(
        uint256 indexed openingId, uint256 indexed oldRequestId, uint256 indexed newRequestId, uint256 vrfFee
    );
    event Fulfilled(uint256 indexed openingId, uint256 indexed requestId, bytes32 word);
    event OutcomeDrawn(
        uint256 indexed openingId,
        uint256 boxIndex,
        uint256 indexed machineId,
        uint256 tier,
        uint256 outcomeIndex,
        uint256 valueUsdc
    );
    event CardDrawn(
        uint256 indexed openingId,
        address indexed opener,
        address indexed token,
        uint256 machineId,
        uint256 boxIndex,
        uint256 cardIndex,
        uint256 amount,
        uint256 tier,
        bool paid
    );
    event Refunded(
        uint256 indexed openingId, address indexed opener, uint256 boxIndex, uint256 cardIndex, uint256 amount
    );
    event Revealed(uint256 indexed openingId, address indexed opener, uint256 cardsPaid, uint256 refund);
    event BoxesReturned(uint256 indexed openingId, address indexed opener, uint256 machineId, uint256 boxes);
    event LinkCreated(
        uint256 indexed linkId,
        address indexed sender,
        address indexed linkKey,
        uint256 machineId,
        uint256 boxes,
        uint256 expiresAt
    );
    event LinkClaimed(uint256 indexed linkId, address indexed sender, address indexed recipient, uint256 boxes);
    event LinkReclaimed(uint256 indexed linkId, address indexed sender, uint256 boxes);
    event CreditAdded(address indexed to, uint256 amount);
    event CreditClaimed(address indexed to, uint256 amount);
    event MachineSet(
        uint256 indexed machineId, uint256 price, uint256 floorBps, uint256 capBps, uint256 rtpMinBps, uint256 rtpMaxBps
    );
    event PrizesSet(uint256 indexed machineId, uint256 indexed tableId, uint256 count, uint256 rtpBps, address by);
    event OperatorSet(address operator);
    event PolicySet(address priceSource, uint256 dailyCap);
    event SinkSet(address sink, bool allowed);
    event Spent(address indexed sink, address indexed stock, uint256 amount, uint256 sharesOut);
    event VrfConfigSet(uint32 callbackGasLimit, uint256 maxVrfSubsidy);

    // ------------------------------------------------------------------ errors

    error ZeroAmount();
    error WrongPayment();
    error TooManyBoxes();
    error UnknownMachine();
    error NoPrizes();
    error BadPrize(uint256 index);
    error BelowFloor(uint256 index, uint256 valueBps);
    error AboveCap(uint256 index, uint256 valueBps);
    error RtpOutOfBand(uint256 rtpBps);
    error NotPending();
    error NotReady();
    error NotExpired();
    error AlreadyFulfilled();
    error NotOpener();
    error UnexpectedCallback();
    error VrfFeeTopUp(uint256 required, uint256 sent);
    error TransferFailed();
    error NotOperator();
    error NoPriceSource();
    error NotSink();
    error OverDailyCap();
    error Slippage(uint256 got, uint256 minOut);
    error BadMachine();
    error BadGas();
    error BadLink();
    error LinkKeyUsed();
    error LinkNotOpen();
    error LinkExpired();
    error LinkNotExpired();
    error BadSignature();
    error NotSender();
    error NoCredit();
    error RenounceDisabled();

    // ------------------------------------------------------------------ constructor

    constructor(string memory uri_, address coordinator_, uint256 maxVrfSubsidy_)
        ERC1155(uri_)
        Ownable(msg.sender)
        EIP712("arclaw", "1")
        D20Randomness(coordinator_)
    {
        maxVrfSubsidy = maxVrfSubsidy_;
    }

    // ================================================================== players

    /// @notice One play = one sealed box of `machineId`. Pay exactly `boxes * price`.
    function play(uint256 machineId, uint256 boxes) external payable whenNotPaused nonReentrant {
        uint256 price = machines[machineId].price;
        if (price == 0) revert UnknownMachine();
        if (boxes == 0) revert ZeroAmount();
        if (msg.value != boxes * price) revert WrongPayment();
        boxesSold[machineId] += boxes;
        emit Played(msg.sender, machineId, boxes, msg.value);
        _mint(msg.sender, machineId, boxes, "");
    }

    /// @notice One sealed `machineId` box to each recipient.
    function gift(uint256 machineId, address[] calldata recipients) external nonReentrant {
        for (uint256 i; i < recipients.length; ++i) {
            emit Gifted(msg.sender, recipients[i], machineId, 1);
            _safeTransferFrom(msg.sender, recipients[i], machineId, 1, "");
        }
    }

    /// @notice Burn `boxes` of `machineId` and request one random word for all of them.
    /// @dev The contract pays the VRF fee up to `maxVrfSubsidy`; above that the caller tops up via msg.value.
    function open(uint256 machineId, uint256 boxes)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 openingId, uint256 requestId)
    {
        if (boxes == 0) revert ZeroAmount();
        if (boxes > MAX_BOXES_PER_OPEN) revert TooManyBoxes();
        uint256 t = currentTable[machineId];
        if (t == 0) revert NoPrizes();

        _burn(msg.sender, machineId, boxes);
        openingId = nextOpeningId++;
        boxesOpened += boxes;
        Opening storage o = openings[openingId];
        o.opener = msg.sender;
        // forge-lint: disable-next-line(unsafe-typecast)
        o.boxes = uint32(boxes); // <= MAX_BOXES_PER_OPEN
        o.tableId = SafeCast.toUint32(t - 1);
        o.machineId = SafeCast.toUint16(machineId);
        o.status = OpeningStatus.Pending;
        o.requestedAt = uint64(block.timestamp);

        uint256 fee;
        (requestId, fee) = _request(openingId);
        o.requestId = requestId;
        openingOfRequest[requestId] = openingId + 1;
        emit Opened(openingId, requestId, msg.sender, machineId, boxes, t - 1, fee);
    }

    /// @notice Pay out a fulfilled opening. Anyone may call; cards always go to the opener.
    /// @dev Works even if the VRF callback failed: the word is then read from the coordinator.
    function reveal(uint256 openingId) external nonReentrant {
        Opening storage o = openings[openingId];
        bytes32 word = o.word;
        if (o.status == OpeningStatus.Pending) {
            (bool fulfilled,, bytes32 w) = _randomnessStatus(o.requestId);
            if (!fulfilled) revert NotReady();
            word = w;
        } else if (o.status != OpeningStatus.Fulfilled) {
            revert NotPending();
        }
        o.status = OpeningStatus.Revealed;
        o.word = word;
        delete openingOfRequest[o.requestId];

        Opening memory m = o;
        uint256 paid;
        uint256 refund;
        for (uint256 b; b < m.boxes; ++b) {
            (uint256 p, uint256 r) = _payBox(openingId, m, b);
            paid += p;
            refund += r;
        }
        cardsPaid += paid;
        cardsRefunded += uint256(m.boxes) * CARDS_PER_BOX - paid;
        emit Revealed(openingId, m.opener, paid, refund);
        if (refund > 0) _sendNative(m.opener, refund);
    }

    /// @notice The request expired unfulfilled (D20: 60 s). Ask again; the boxes stay committed. Anyone may call.
    /// @dev The expired fee is refundable to this contract via coordinator.refundRequest(oldRequestId).
    function retry(uint256 openingId) external payable nonReentrant returns (uint256 requestId) {
        Opening storage o = openings[openingId];
        if (o.status != OpeningStatus.Pending) revert NotPending();
        uint256 old = o.requestId;
        _requireExpired(old);
        delete openingOfRequest[old];

        uint256 fee;
        (requestId, fee) = _request(openingId);
        o.requestId = requestId;
        o.requestedAt = uint64(block.timestamp);
        openingOfRequest[requestId] = openingId + 1;
        emit Rerequested(openingId, old, requestId, fee);
    }

    /// @notice The request expired unfulfilled: the opener takes the sealed boxes back instead of retrying.
    function returnBoxes(uint256 openingId) external nonReentrant {
        Opening storage o = openings[openingId];
        if (o.status != OpeningStatus.Pending) revert NotPending();
        if (msg.sender != o.opener) revert NotOpener();
        _requireExpired(o.requestId);
        o.status = OpeningStatus.Returned;
        delete openingOfRequest[o.requestId];
        uint256 boxes = o.boxes;
        boxesOpened -= boxes;
        emit BoxesReturned(openingId, msg.sender, o.machineId, boxes);
        _mint(msg.sender, o.machineId, boxes, "");
    }

    /// @notice Pull native USDC that could not be pushed (the receiver rejected it, or the pool was short).
    function claimCredit() external nonReentrant {
        uint256 amount = credit[msg.sender];
        if (amount == 0) revert NoCredit();
        credit[msg.sender] = 0;
        emit CreditClaimed(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ================================================================== claim links

    /// @notice Escrow `boxes` of `machineId` under an ephemeral public key shared off-chain in the link.
    function createLink(address linkKey, uint256 machineId, uint32 boxes, uint40 expiresAt)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 linkId)
    {
        if (linkKey == address(0) || boxes == 0 || expiresAt <= block.timestamp) revert BadLink();
        if (linkKeyUsed[linkKey]) revert LinkKeyUsed();
        linkKeyUsed[linkKey] = true;
        linkId = nextLinkId++;
        links[linkId] =
            Link(msg.sender, boxes, SafeCast.toUint16(machineId), expiresAt, LinkStatus.Open, linkKey);
        escrowed[machineId] += boxes;
        // Plain move into this contract's balance, no receiver hook. This contract is not an ERC1155Receiver, so
        // nobody else can push boxes in: balanceOf(this, id) == escrowed[id].
        _update(msg.sender, address(this), _one(machineId), _one(boxes));
        emit LinkCreated(linkId, msg.sender, linkKey, machineId, boxes, expiresAt);
    }

    /// @notice Claim a link for `recipient`. `signature` is the link key's EIP-712 signature over
    ///         Claim(linkId, recipient) in this contract's domain (name "arclaw", version "1", chainId, address).
    ///         Anyone may relay it; a front-runner can only deliver the boxes to the same recipient.
    function claimLink(uint256 linkId, address recipient, bytes calldata signature) external nonReentrant {
        Link storage l = links[linkId];
        if (l.status != LinkStatus.Open) revert LinkNotOpen();
        if (block.timestamp > l.expiresAt) revert LinkExpired();
        if (recipient == address(0)) revert BadLink();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(claimDigest(linkId, recipient), signature);
        if (err != ECDSA.RecoverError.NoError || signer != l.linkKey) revert BadSignature();

        l.status = LinkStatus.Claimed;
        (uint256 id, uint256 boxes) = (l.machineId, l.boxes);
        escrowed[id] -= boxes;
        emit LinkClaimed(linkId, l.sender, recipient, boxes);
        _safeTransferFrom(address(this), recipient, id, boxes, "");
    }

    /// @notice After expiry the sender takes unclaimed boxes back.
    function reclaimLink(uint256 linkId) external nonReentrant {
        Link storage l = links[linkId];
        if (l.status != LinkStatus.Open) revert LinkNotOpen();
        if (msg.sender != l.sender) revert NotSender();
        if (block.timestamp <= l.expiresAt) revert LinkNotExpired();
        l.status = LinkStatus.Reclaimed;
        (uint256 id, uint256 boxes) = (l.machineId, l.boxes);
        escrowed[id] -= boxes;
        emit LinkReclaimed(linkId, msg.sender, boxes);
        _safeTransferFrom(address(this), msg.sender, id, boxes, "");
    }

    /// @notice The EIP-712 digest a link key signs.
    function claimDigest(uint256 linkId, address recipient) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, linkId, recipient)));
    }

    // ================================================================== views

    function machineIds() external view returns (uint256[] memory) {
        return _machineIds;
    }

    /// @notice Current outcome table of a machine.
    function outcomes(uint256 machineId) external view returns (Outcome[] memory) {
        uint256 t = currentTable[machineId];
        if (t == 0) return new Outcome[](0);
        return _tables[t - 1];
    }

    function tableCount() external view returns (uint256) {
        return _tables.length;
    }

    /// @notice Realised odds of a stored table: expected value, smallest and largest outcome, in bps of the
    ///         machine's current price, plus the total weight.
    function tableStats(uint256 tableId)
        external
        view
        returns (uint256 rtpBps, uint256 minBps, uint256 maxBps, uint256 totalWeight)
    {
        Outcome[] storage t = _tables[tableId];
        uint256 price = machines[tableMachine[tableId]].price;
        uint256 ev;
        minBps = type(uint256).max;
        for (uint256 i; i < t.length; ++i) {
            uint256 v = t[i].value;
            totalWeight += t[i].weight;
            ev += v * t[i].weight;
            uint256 bps = v * 10_000 / price;
            if (bps < minBps) minBps = bps;
            if (bps > maxBps) maxBps = bps;
        }
        rtpBps = ev * 10_000 / totalWeight / price;
    }

    /// @notice Current exact VRF fee for one open (valid inside a transaction; via eth_call the base fee may read 0).
    function quoteVrfFee() external view returns (uint256) {
        return _quoteRandomness(callbackGasLimit);
    }

    /// @notice Card value in native USDC (18 dp) at the price source's price.
    function valueOf(address token, uint256 amount) public view returns (uint256) {
        if (address(priceSource) == address(0)) revert NoPriceSource();
        return amount * priceSource.priceOf(token) * 1e12 / 10 ** IERC20Metadata(token).decimals();
    }

    // ================================================================== operator

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @notice Reprice a machine's table. Lands only if it satisfies the machine's floor, cap and RTP band.
    function operatorSetPrizes(uint256 machineId, OutcomeInput[] calldata input) external onlyOperator {
        _setPrizes(machineId, input);
    }

    /// @notice Restock: buy `stock` on an allow-listed Astock desk with `amount` native USDC, delivered here.
    ///         Capped per UTC day; reverts unless at least `minSharesOut` arrived.
    function spend(address sink, address stock, uint256 amount, uint256 minSharesOut)
        external
        onlyOperator
        nonReentrant
        returns (uint256 got)
    {
        if (!sinks[sink]) revert NotSink();
        if (amount == 0 || minSharesOut == 0) revert ZeroAmount();
        uint256 day = block.timestamp / 1 days;
        if (day != spentDay) (spentDay, spentToday) = (day, 0);
        if (spentToday + amount > dailyCap) revert OverDailyCap();
        spentToday += amount;

        uint256 before = IERC20(stock).balanceOf(address(this));
        IAstockDesk(sink).buy{value: amount}(stock, minSharesOut, address(this));
        got = IERC20(stock).balanceOf(address(this)) - before;
        if (got < minSharesOut) revert Slippage(got, minSharesOut);
        emit Spent(sink, stock, amount, got);
    }

    // ================================================================== owner

    /// @notice Owner sets a table; the machine's rules still apply (the owner moves the rules via setMachine).
    function setPrizes(uint256 machineId, OutcomeInput[] calldata input) external onlyOwner {
        _setPrizes(machineId, input);
    }

    /// @notice Create or update a machine and its rules. price 0 stops new plays (opens and reveals continue).
    ///         Rules apply to tables set from now on; the current table keeps serving until replaced.
    ///         Bounds: floor >= MIN_FLOOR_BPS, floor <= rtpMin <= rtpMax <= min(MAX_RTP_BPS, cap), cap <= MAX_CAP_BPS.
    function setMachine(
        uint256 machineId,
        uint128 price,
        uint16 floorBps,
        uint32 capBps,
        uint16 rtpMinBps,
        uint16 rtpMaxBps
    ) external onlyOwner {
        if (machineId == 0 || machineId > type(uint16).max) revert BadMachine();
        if (
            floorBps < MIN_FLOOR_BPS || floorBps > rtpMinBps || rtpMinBps > rtpMaxBps || rtpMaxBps > MAX_RTP_BPS
                || rtpMaxBps > capBps || capBps > MAX_CAP_BPS
        ) revert BadMachine();
        Machine storage m = machines[machineId];
        if (m.capBps == 0) _machineIds.push(machineId);
        (m.price, m.floorBps, m.capBps, m.rtpMinBps, m.rtpMaxBps) = (price, floorBps, capBps, rtpMinBps, rtpMaxBps);
        emit MachineSet(machineId, price, floorBps, capBps, rtpMinBps, rtpMaxBps);
    }

    function setOperator(address op) external onlyOwner {
        operator = op;
        emit OperatorSet(op);
    }

    function setPolicy(IPriceSource source, uint256 cap) external onlyOwner {
        (priceSource, dailyCap) = (source, cap);
        emit PolicySet(address(source), cap);
    }

    function setSink(address sink, bool allowed) external onlyOwner {
        sinks[sink] = allowed;
        emit SinkSet(sink, allowed);
    }

    function setVrfConfig(uint32 gasLimit, uint256 subsidy) external onlyOwner {
        if (gasLimit < MIN_CALLBACK_GAS || gasLimit > MAX_CALLBACK_GAS) revert BadGas();
        (callbackGasLimit, maxVrfSubsidy) = (gasLimit, subsidy);
        emit VrfConfigSet(gasLimit, subsidy);
    }

    function setURI(string calldata uri_) external onlyOwner {
        _setURI(uri_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function sweep(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(to, amount);
    }

    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice Accepts desk change, VRF fee refunds and treasury top-ups.
    receive() external payable {}

    // ================================================================== internal

    /// Stores the word only: D20 forwards exactly callbackGasLimit, so payouts happen in reveal().
    function _onRandomness(uint256 requestId, bytes32 word) internal override {
        uint256 idPlusOne = openingOfRequest[requestId];
        if (idPlusOne == 0) revert UnexpectedCallback();
        Opening storage o = openings[idPlusOne - 1];
        if (o.status != OpeningStatus.Pending || o.requestId != requestId) revert UnexpectedCallback();
        o.word = word;
        o.status = OpeningStatus.Fulfilled;
        emit Fulfilled(idPlusOne - 1, requestId, word);
    }

    function _request(uint256 openingId) internal returns (uint256 requestId, uint256 fee) {
        uint32 gasLimit = callbackGasLimit;
        fee = _quoteRandomness(gasLimit);
        uint256 required = fee > maxVrfSubsidy ? fee - maxVrfSubsidy : 0;
        if (msg.value < required) revert VrfFeeTopUp(required, msg.value);
        vrfFeesPaid += fee;
        bytes32 seed = keccak256(abi.encode(address(this), openingId, msg.sender, block.number));
        requestId = _requestRandomness(seed, gasLimit, fee);
        uint256 change = msg.value - required;
        if (change > 0) _sendNative(msg.sender, change);
    }

    function _requireExpired(uint256 requestId) internal view {
        (bool fulfilled, bool expired,) = _randomnessStatus(requestId);
        if (fulfilled) revert AlreadyFulfilled();
        if (!expired) revert NotExpired();
    }

    function _payBox(uint256 openingId, Opening memory m, uint256 b) internal returns (uint256 paid, uint256 refund) {
        Outcome[] storage t = _tables[m.tableId];
        uint256 idx = _draw(t, tableWeight[m.tableId], uint256(keccak256(abi.encode(m.word, b))));
        Outcome storage out = t[idx];
        uint256 tier = out.tier;
        emit OutcomeDrawn(openingId, b, m.machineId, tier, idx, out.value);
        for (uint256 c; c < CARDS_PER_BOX; ++c) {
            Card memory card = out.cards[c];
            bool ok = _balanceOf(card.token) >= card.amount
                && IERC20(card.token).trySafeTransfer(m.opener, card.amount);
            emit CardDrawn(openingId, m.opener, card.token, m.machineId, b, c, card.amount, tier, ok);
            if (ok) {
                ++paid;
                paidOut[card.token] += card.amount;
            } else {
                refund += card.value;
                emit Refunded(openingId, m.opener, b, c, card.value);
            }
        }
    }

    function _draw(Outcome[] storage t, uint256 w, uint256 rand) internal view returns (uint256) {
        uint256 r = rand % w;
        uint256 n = t.length;
        for (uint256 i; i < n; ++i) {
            uint256 wi = t[i].weight;
            if (r < wi) return i;
            r -= wi;
        }
        revert NoPrizes(); // unreachable: weights sum to w
    }

    function _balanceOf(address token) internal view returns (uint256) {
        try IERC20(token).balanceOf(address(this)) returns (uint256 b) {
            return b;
        } catch {
            return 0;
        }
    }

    /// Prices every card and enforces floor, cap and RTP band. Returns the card values (USDC 18 dp).
    function _evaluate(uint256 machineId, OutcomeInput[] calldata input)
        internal
        view
        returns (uint256 rtpBps, uint256[3][] memory values)
    {
        Machine memory mc = machines[machineId];
        if (mc.price == 0) revert UnknownMachine();
        if (input.length == 0) revert NoPrizes();
        values = new uint256[3][](input.length);
        uint256 w;
        uint256 ev;
        for (uint256 i; i < input.length; ++i) {
            OutcomeInput calldata p = input[i];
            if (p.weight == 0) revert BadPrize(i);
            uint256 v;
            for (uint256 c; c < CARDS_PER_BOX; ++c) {
                if (p.tokens[c] == address(0) || p.amounts[c] == 0) revert BadPrize(i);
                values[i][c] = valueOf(p.tokens[c], p.amounts[c]);
                v += values[i][c];
            }
            if (v * 10_000 < uint256(mc.floorBps) * mc.price) revert BelowFloor(i, v * 10_000 / mc.price);
            if (v * 10_000 > uint256(mc.capBps) * mc.price) revert AboveCap(i, v * 10_000 / mc.price);
            w += p.weight;
            ev += v * p.weight;
        }
        rtpBps = ev * 10_000 / w / mc.price;
        if (ev * 10_000 < uint256(mc.rtpMinBps) * mc.price * w || ev * 10_000 > uint256(mc.rtpMaxBps) * mc.price * w)
        {
            revert RtpOutOfBand(rtpBps);
        }
    }

    function _setPrizes(uint256 machineId, OutcomeInput[] calldata input) internal {
        (uint256 rtpBps, uint256[3][] memory values) = _evaluate(machineId, input);
        Outcome[] storage t = _tables.push();
        uint256 tableId = _tables.length - 1;
        uint256 w;
        for (uint256 i; i < input.length; ++i) {
            OutcomeInput calldata p = input[i];
            Outcome storage o = t.push();
            uint256 v;
            for (uint256 c; c < CARDS_PER_BOX; ++c) {
                o.cards[c] = Card(p.tokens[c], SafeCast.toUint96(values[i][c]), p.amounts[c]);
                v += values[i][c];
            }
            (o.weight, o.tier, o.value) = (p.weight, p.tier, SafeCast.toUint128(v));
            w += p.weight;
        }
        tableWeight.push(w);
        tableMachine.push(machineId);
        currentTable[machineId] = tableId + 1;
        emit PrizesSet(machineId, tableId, input.length, rtpBps, msg.sender);
    }

    /// Push native USDC; if the receiver rejects it or the pool is short, keep it as pull credit so a reveal
    /// is never blocked.
    function _sendNative(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) {
            credit[to] += amount;
            emit CreditAdded(to, amount);
        }
    }

    function _one(uint256 x) private pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = x;
    }
}
