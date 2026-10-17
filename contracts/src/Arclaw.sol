// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IPriceSource} from "./interfaces/IPriceSource.sol";
import {IAstockDesk} from "./interfaces/IAstock.sol";
import {D20Randomness} from "./vrf/D20Randomness.sol";
import {ILuck} from "./LuckVault.sol";

/// @title Arclaw: claw machines that pay sealed packs of tokenized stock on Arc
/// @notice Each machine is an ERC-1155 id with its own price. Pay the price in native USDC (18 dp) per play, get one
///         sealed box of that machine. Opening burns boxes and asks the VRF for one word; once it lands anyone can
///         `reveal`, which draws ONE weighted outcome per box (a pack of 3 cards) from the machine's table frozen at
///         open time and pays the cards from inventory. A card the inventory cannot cover is first bought just in
///         time on the allow-listed desk with box revenue; only if that is off or fails is it refunded in USDC at
///         the lower of its value when the table was set and its current value.
///         Every table, whoever sets it, must satisfy the machine's rules: each outcome worth at least floorBps and
///         at most capBps of the price, and the weighted expected value inside [rtpMinBps, rtpMaxBps].
contract Arclaw is ERC1155, Ownable2Step, Pausable, ReentrancyGuard, D20Randomness {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants

    uint256 public constant CARDS_PER_BOX = 3;
    uint256 public constant MAX_BOXES_PER_OPEN = 20;
    uint256 public constant MAX_OUTCOMES = 64; // bounds setPrizes gas and the reveal draw scan
    /// Luck boost ceiling: with probability boost/10000 a box draws twice and keeps the better pack. Every table's
    /// RTP band is checked at this maximum, so no holder can push a machine past rtpMaxBps.
    uint256 public constant MAX_BOOST_BPS = 100;
    uint32 public constant MIN_CALLBACK_GAS = 30_000; // D20 bounds
    uint32 public constant MAX_CALLBACK_GAS = 1_000_000;
    /// Sanity bounds on the owner's per-machine rules.
    uint16 public constant MIN_FLOOR_BPS = 3000; // never less than 30% back
    uint16 public constant MAX_RTP_BPS = 9500; // house edge never under 5%
    uint32 public constant MAX_CAP_BPS = 1_000_000; // 100x

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

    // ------------------------------------------------------------------ storage

    mapping(uint256 => Machine) public machines;
    uint256[] internal _machineIds;
    /// machineId => current tableId + 1
    mapping(uint256 => uint256) public currentTable;

    /// Append-only table history; an opening draws from the table current when it opened.
    Outcome[][] internal _tables;
    uint256[] public tableWeight;
    uint256[] public tableMachine;
    /// Machine price each table was validated against; open() refuses a mismatch.
    uint256[] public tablePrice;
    /// When each table was priced; open() refuses tables older than maxTableAge.
    uint256[] public tablePricedAt;
    uint256 public maxTableAge = 1 days;
    /// machineId => no new plays or opens (owner switch); reveals, returns and links keep working.
    mapping(uint256 => bool) public machineOff;

    mapping(uint256 => Opening) public openings;
    /// requestId => openingId + 1 (0 = unknown or superseded)
    mapping(uint256 => uint256) public openingOfRequest;
    uint256 public nextOpeningId;


    mapping(address => uint256) public credit;
    /// Liabilities the owner and operator cannot touch (see freeBalance):
    /// owed credit, plus the price paid for every box still waiting to be revealed or returned.
    uint256 public reservedCredit;
    uint256 public pendingReserve;

    /// Just-in-time restock at reveal: a short card is bought on `jit.desk` (must also be an allow-listed sink)
    /// with box revenue, instead of being refunded. Bounded per card, per reveal and by the free balance.
    struct Jit {
        address desk; // 0 = off
        uint16 slippageBps; // native sent = price-source value of the shortfall x (1 + slippage)
        uint8 maxBuys; // per reveal
        uint128 maxPerCard; // native wei
    }

    Jit public jit;
    /// Float kept for big wins: withdraw and spend leave it alone, JIT buys may use it.
    uint256 public reserveFloor;
    uint256 internal transient _jitBuys;

    /// ARCLAW staking vault read at open (0 = boosts off).
    ILuck public luck;
    /// openingId => luck boost (bps) fixed at open
    mapping(uint256 => uint256) public openingBoost;

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
        uint256 vrfFee,
        uint256 boostBps
    );
    event Rerequested(
        uint256 indexed openingId, uint256 indexed oldRequestId, uint256 indexed newRequestId, uint256 vrfFee
    );
    event Fulfilled(uint256 indexed openingId, uint256 indexed requestId, bytes32 word);
    /// One per box: everything a leaderboard needs (player, machine, pack value in USDC 18 dp, luck used).
    event OutcomeDrawn(
        uint256 indexed openingId,
        address indexed opener,
        uint256 indexed machineId,
        uint256 boxIndex,
        uint256 tier,
        uint256 outcomeIndex,
        uint256 valueUsdc,
        bool boosted
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
    event CreditAdded(address indexed to, uint256 amount);
    event CreditClaimed(address indexed to, uint256 amount);
    event MachineActive(uint256 indexed machineId, bool active);
    event MachineSet(
        uint256 indexed machineId, uint256 price, uint256 floorBps, uint256 capBps, uint256 rtpMinBps, uint256 rtpMaxBps
    );
    event PrizesSet(uint256 indexed machineId, uint256 indexed tableId, uint256 count, uint256 rtpBps, address by);
    event OperatorSet(address operator);
    event PolicySet(address priceSource, uint256 dailyCap);
    event SinkSet(address sink, bool allowed);
    event Spent(address indexed sink, address indexed stock, uint256 amount, uint256 sharesOut);
    event MaxTableAgeSet(uint256 maxAge);
    event LuckSet(address vault);
    event JitBought(uint256 indexed openingId, address indexed token, uint256 cost, uint256 shares);
    event JitConfigSet(address desk, uint256 slippageBps, uint256 maxBuys, uint256 maxPerCard, uint256 reserveFloor);
    event VrfConfigSet(uint32 callbackGasLimit, uint256 maxVrfSubsidy);

    // ------------------------------------------------------------------ errors

    error ZeroAmount();
    error WrongPayment();
    error TooManyBoxes();
    error UnknownMachine();
    error NoPrizes();
    error TooManyOutcomes();
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
    error PriceImmutable();
    error MachineOff();
    error TablePriceMismatch();
    error TableStale();
    error BadGas();
    error NoCredit();
    error Reserved(uint256 free);
    error RenounceDisabled();

    // ------------------------------------------------------------------ constructor

    constructor(string memory uri_, address coordinator_, uint256 maxVrfSubsidy_)
        ERC1155(uri_)
        Ownable(msg.sender)
        D20Randomness(coordinator_)
    {
        maxVrfSubsidy = maxVrfSubsidy_;
    }

    // ================================================================== players

    /// @notice One play = one sealed box of `machineId`. Pay exactly `boxes * price`.
    function play(uint256 machineId, uint256 boxes) external payable whenNotPaused nonReentrant {
        uint256 price = machines[machineId].price;
        if (price == 0) revert UnknownMachine();
        if (machineOff[machineId]) revert MachineOff();
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
        if (machineOff[machineId]) revert MachineOff();
        if (tablePrice[t - 1] != machines[machineId].price) revert TablePriceMismatch();
        if (block.timestamp > tablePricedAt[t - 1] + maxTableAge) revert TableStale();

        _burn(msg.sender, machineId, boxes);
        openingId = nextOpeningId++;
        boxesOpened += boxes;
        pendingReserve += boxes * tablePrice[t - 1];
        Opening storage o = openings[openingId];
        o.opener = msg.sender;
        // forge-lint: disable-next-line(unsafe-typecast)
        o.boxes = uint32(boxes); // <= MAX_BOXES_PER_OPEN
        o.tableId = SafeCast.toUint32(t - 1);
        o.machineId = SafeCast.toUint16(machineId);
        o.status = OpeningStatus.Pending;
        o.requestedAt = uint64(block.timestamp);

        uint256 fee;
        (requestId, fee) = _request(openingId, true);
        o.requestId = requestId;
        openingOfRequest[requestId] = openingId + 1;
        uint256 boost = _boostOf(msg.sender);
        if (boost != 0) openingBoost[openingId] = boost;
        emit Opened(openingId, requestId, msg.sender, machineId, boxes, t - 1, fee, boost);
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
        pendingReserve -= uint256(o.boxes) * tablePrice[o.tableId];

        Opening memory m = o;
        uint256 paid;
        uint256 refund;
        _jitBuys = 0;
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

    /// @notice The request expired unfulfilled (D20: 60 s). Ask again; the boxes stay committed. The expired fee is
    ///         reclaimed first. The opener and the operator retry on the house subsidy; anyone else pays the full fee.
    function retry(uint256 openingId) external payable nonReentrant returns (uint256 requestId) {
        Opening storage o = openings[openingId];
        if (o.status != OpeningStatus.Pending) revert NotPending();
        uint256 old = o.requestId;
        _requireExpired(old);
        delete openingOfRequest[old];
        _refundRandomness(old);

        uint256 fee;
        (requestId, fee) = _request(openingId, msg.sender == o.opener || msg.sender == operator);
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
        _refundRandomness(o.requestId);
        uint256 boxes = o.boxes;
        boxesOpened -= boxes;
        pendingReserve -= boxes * tablePrice[o.tableId];
        emit BoxesReturned(openingId, msg.sender, o.machineId, boxes);
        _mint(msg.sender, o.machineId, boxes, "");
    }

    /// @notice Pull native USDC that could not be pushed (the receiver rejected it, or the pool was short).
    function claimCredit() external {
        claimCredit(msg.sender);
    }

    /// @notice Same, paid to `to` (for smart accounts that cannot receive native USDC themselves).
    function claimCredit(address to) public nonReentrant {
        uint256 amount = credit[msg.sender];
        if (amount == 0) revert NoCredit();
        credit[msg.sender] = 0;
        reservedCredit -= amount;
        emit CreditClaimed(msg.sender, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
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

    /// @notice Native balance above owed credit, pending boxes and the reserve floor: what withdraw and spend may use.
    function freeBalance() public view returns (uint256) {
        uint256 bal = address(this).balance;
        uint256 owed = reservedCredit + pendingReserve + reserveFloor;
        return bal > owed ? bal - owed : 0;
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
        _requireFree(amount);
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

    /// @notice Create a machine, or update the rules of an existing one. The price is fixed at creation: boxes are
    ///         fungible per id, so a price change would re-rate boxes already sold. A new price is a new machine id.
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
        if (machineId == 0 || machineId > type(uint16).max || price == 0) revert BadMachine();
        if (
            floorBps < MIN_FLOOR_BPS || floorBps > rtpMinBps || rtpMinBps > rtpMaxBps || rtpMaxBps > MAX_RTP_BPS
                || rtpMaxBps > capBps || capBps > MAX_CAP_BPS
        ) revert BadMachine();
        Machine storage m = machines[machineId];
        if (m.price == 0) _machineIds.push(machineId);
        else if (m.price != price) revert PriceImmutable(); // a new price is a new machine id
        (m.price, m.floorBps, m.capBps, m.rtpMinBps, m.rtpMaxBps) = (price, floorBps, capBps, rtpMinBps, rtpMaxBps);
        emit MachineSet(machineId, price, floorBps, capBps, rtpMinBps, rtpMaxBps);
    }

    /// @notice Stop or resume new plays and opens on a machine (reveals, returns and links continue).
    function setMachineActive(uint256 machineId, bool active) external onlyOwner {
        if (machines[machineId].price == 0) revert UnknownMachine();
        machineOff[machineId] = !active;
        emit MachineActive(machineId, active);
    }

    /// @notice The ARCLAW staking vault (LuckVault). Zero turns boosts off for new opens.
    function setLuck(ILuck vault) external onlyOwner {
        luck = vault;
        emit LuckSet(address(vault));
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

    /// @notice Just-in-time restock at reveal. desk 0 turns it off. slippageBps <= 1000, maxBuys <= 60.
    function setJit(address desk, uint16 slippageBps, uint8 maxBuys, uint128 maxPerCard, uint256 floor_)
        external
        onlyOwner
    {
        if (slippageBps > 1000 || maxBuys > MAX_BOXES_PER_OPEN * CARDS_PER_BOX) revert BadMachine();
        jit = Jit(desk, slippageBps, maxBuys, maxPerCard);
        reserveFloor = floor_;
        emit JitConfigSet(desk, slippageBps, maxBuys, maxPerCard, floor_);
    }

    function setVrfConfig(uint32 gasLimit, uint256 subsidy) external onlyOwner {
        if (gasLimit < MIN_CALLBACK_GAS || gasLimit > MAX_CALLBACK_GAS) revert BadGas();
        (callbackGasLimit, maxVrfSubsidy) = (gasLimit, subsidy);
        emit VrfConfigSet(gasLimit, subsidy);
    }

    /// @notice How long a priced table may keep serving new opens before the operator must reprice it.
    function setMaxTableAge(uint256 maxAge) external onlyOwner {
        if (maxAge == 0) revert BadMachine();
        maxTableAge = maxAge;
        emit MaxTableAgeSet(maxAge);
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

    /// @notice Only the free balance: owed credit and pending openings stay backed.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        _requireFree(amount);
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

    /// Pays the fee; with `subsidised` the house covers up to maxVrfSubsidy, otherwise the caller pays it all.
    function _request(uint256 openingId, bool subsidised) internal returns (uint256 requestId, uint256 fee) {
        uint32 gasLimit = callbackGasLimit;
        fee = _quoteRandomness(gasLimit);
        uint256 required = !subsidised ? fee : fee > maxVrfSubsidy ? fee - maxVrfSubsidy : 0;
        if (msg.value < required) revert VrfFeeTopUp(required, msg.value);
        vrfFeesPaid += fee;
        bytes32 seed = keccak256(abi.encode(address(this), openingId, msg.sender, block.number));
        requestId = _requestRandomness(seed, gasLimit, fee);
        uint256 change = msg.value - required;
        if (change > 0) _sendNative(msg.sender, change);
    }

    function _requireFree(uint256 amount) internal view {
        uint256 free = freeBalance();
        if (amount > free) revert Reserved(free);
    }

    function _requireExpired(uint256 requestId) internal view {
        (bool fulfilled, bool expired,) = _randomnessStatus(requestId);
        if (fulfilled) revert AlreadyFulfilled();
        if (!expired) revert NotExpired();
    }

    function _payBox(uint256 openingId, Opening memory m, uint256 b) internal returns (uint256 paid, uint256 refund) {
        Outcome[] storage t = _tables[m.tableId];
        uint256 w = tableWeight[m.tableId];
        uint256 idx = _draw(t, w, uint256(keccak256(abi.encode(m.word, b))));
        // Luck: with probability boost/10000 draw a second pack from an independent stream and keep the better one.
        uint256 boost = openingBoost[openingId];
        bool boosted;
        if (boost != 0 && uint256(keccak256(abi.encode(m.word, b, "luck"))) % 10_000 < boost) {
            uint256 alt = _draw(t, w, uint256(keccak256(abi.encode(m.word, b, "luck", 1))));
            boosted = true;
            if (t[alt].value > t[idx].value) idx = alt;
        }
        Outcome storage out = t[idx];
        uint256 tier = out.tier;
        emit OutcomeDrawn(openingId, m.opener, m.machineId, b, tier, idx, out.value, boosted);
        for (uint256 c; c < CARDS_PER_BOX; ++c) {
            Card memory card = out.cards[c];
            uint256 have = _balanceOf(card.token);
            if (have < card.amount && _jitBuy(openingId, card.token, card.amount - have)) {
                have = _balanceOf(card.token);
            }
            bool ok = have >= card.amount && IERC20(card.token).trySafeTransfer(m.opener, card.amount);
            emit CardDrawn(openingId, m.opener, card.token, m.machineId, b, c, card.amount, tier, ok);
            if (ok) {
                ++paid;
                paidOut[card.token] += card.amount;
            } else {
                uint256 r = _refundValue(card);
                refund += r;
                emit Refunded(openingId, m.opener, b, c, r);
            }
        }
    }

    /// Luck boost of `player`, capped at MAX_BOOST_BPS. A missing or failing vault means no boost, never a revert.
    function _boostOf(address player) internal view returns (uint256 bps) {
        ILuck l = luck;
        if (address(l) == address(0)) return 0;
        try l.boostOf(player) returns (uint256 b) {
            return b > MAX_BOOST_BPS ? MAX_BOOST_BPS : b;
        } catch {
            return 0;
        }
    }

    /// Buys `shares` of `token` on the JIT desk with native above owed credit and pending boxes (reserveFloor may
    /// be used). Never reverts: any failure (off, cap hit, price unavailable, desk revert) returns false and the
    /// caller refunds the card instead.
    function _jitBuy(uint256 openingId, address token, uint256 shares) internal returns (bool) {
        Jit memory j = jit;
        if (j.desk == address(0) || !sinks[j.desk] || _jitBuys >= j.maxBuys) return false;
        uint256 cost;
        try this.valueOf(token, shares) returns (uint256 v) {
            cost = v * (10_000 + j.slippageBps) / 10_000 + 1;
        } catch {
            return false;
        }
        uint256 owed = reservedCredit + pendingReserve;
        if (cost > j.maxPerCard || address(this).balance < owed + cost) return false;
        ++_jitBuys;
        uint256 before = _balanceOf(token);
        try IAstockDesk(j.desk).buy{value: cost}(token, shares, address(this)) {}
        catch {
            return false;
        }
        uint256 got = _balanceOf(token) - before;
        emit JitBought(openingId, token, cost, got);
        return got >= shares;
    }

    /// A short card refunds the lower of its value when the table was set and its value now, so a fall in the
    /// stock between open and reveal cannot be cashed out at the old price. If the price source fails, the
    /// table-time value is used: a reveal is never blocked by the oracle.
    function _refundValue(Card memory card) internal view returns (uint256) {
        try this.valueOf(card.token, card.amount) returns (uint256 v) {
            return v < card.value ? v : card.value;
        } catch {
            return card.value;
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
        if (input.length > MAX_OUTCOMES) revert TooManyOutcomes();
        values = new uint256[3][](input.length);
        uint256[] memory vs = new uint256[](input.length);
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
            vs[i] = v;
            w += p.weight;
            ev += v * p.weight;
        }
        rtpBps = ev * 10_000 / w / mc.price;
        if (ev * 10_000 < uint256(mc.rtpMinBps) * mc.price * w) revert RtpOutOfBand(rtpBps);
        // Max-boost EV = (1 - q) EV + q E[max of two draws], q = MAX_BOOST_BPS / 10000. Scaled by 10000 W^2:
        // (10000 - MAX_BOOST_BPS) * ev * W + MAX_BOOST_BPS * sum_ij w_i w_j max(v_i, v_j)  <=  rtpMax * price * W^2
        uint256 pairs;
        for (uint256 i; i < vs.length; ++i) {
            uint256 wi = input[i].weight;
            for (uint256 j; j < vs.length; ++j) {
                pairs += wi * input[j].weight * (vs[i] > vs[j] ? vs[i] : vs[j]);
            }
        }
        uint256 lucky = (10_000 - MAX_BOOST_BPS) * ev * w + MAX_BOOST_BPS * pairs;
        if (lucky > uint256(mc.rtpMaxBps) * mc.price * w * w) revert RtpOutOfBand(lucky / w / w / mc.price);
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
        tablePrice.push(machines[machineId].price);
        tablePricedAt.push(block.timestamp);
        currentTable[machineId] = tableId + 1;
        emit PrizesSet(machineId, tableId, input.length, rtpBps, msg.sender);
    }

    /// Push native USDC; if the receiver rejects it or the pool is short, keep it as pull credit so a reveal
    /// is never blocked.
    function _sendNative(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) {
            credit[to] += amount;
            reservedCredit += amount;
            emit CreditAdded(to, amount);
        }
    }
}
