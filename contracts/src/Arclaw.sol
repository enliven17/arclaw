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

/// @title Arclaw: sealed boxes of tokenized stock on Arc
/// @notice Pay `boxPrice` native USDC (18 dp) per play, get one sealed box (ERC-1155 id 0). Opening burns boxes and
///         asks the VRF for one word; once it lands anyone can `reveal`, which draws 3 cards per box from the prize
///         table frozen at open time and pays them from inventory. A card the inventory cannot cover is refunded at
///         boxPrice/3 (snapshotted at open). Boxes can be gifted directly or escrowed behind a claim link.
///         Owner sets the rules; the operator (treasury agent) reprices inside the payout band and restocks via the
///         Astock desk under a daily cap.
contract Arclaw is ERC1155, Ownable2Step, Pausable, ReentrancyGuard, EIP712, D20Randomness {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants

    uint256 public constant BOX = 0;
    uint256 public constant CARDS_PER_BOX = 3;
    uint256 public constant MAX_BOXES_PER_OPEN = 20;
    uint32 public constant MIN_CALLBACK_GAS = 30_000; // D20 bounds
    uint32 public constant MAX_CALLBACK_GAS = 1_000_000;
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(uint256 linkId,address recipient)");

    string public constant name = "arclaw box";
    string public constant symbol = "CLAW";

    // ------------------------------------------------------------------ types

    /// One card outcome. `tier` is display rarity only (0 common upward); odds come from `weight`.
    struct Prize {
        address token;
        uint88 weight;
        uint8 tier;
        uint256 amount;
    }

    enum OpeningStatus {
        None,
        Pending, // waiting for randomness
        Fulfilled, // word stored, ready to reveal
        Revealed, // cards paid
        Returned // randomness expired, boxes handed back
    }

    struct Opening {
        address opener;
        uint32 boxes;
        uint32 tableId;
        OpeningStatus status;
        uint128 refundPerCard; // boxPrice / 3 at open time
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
        uint64 expiresAt;
        LinkStatus status;
        address linkKey;
    }

    // ------------------------------------------------------------------ storage

    /// Price per box in native USDC (18 decimals on Arc).
    uint256 public boxPrice;

    /// Append-only prize table history; an opening draws from the table that was current when it opened.
    Prize[][] internal _tables;
    uint256[] internal _tableWeight;

    mapping(uint256 => Opening) public openings;
    /// requestId => openingId + 1 (0 = unknown or superseded)
    mapping(uint256 => uint256) public openingOfRequest;
    uint256 public nextOpeningId;

    mapping(uint256 => Link) public links;
    mapping(address => bool) public linkKeyUsed;
    uint256 public nextLinkId;
    uint256 public escrowedBoxes;

    /// Native USDC owed to addresses whose refund push failed (pull with claimCredit).
    mapping(address => uint256) public credit;

    // VRF policy
    uint32 public callbackGasLimit = 100_000;
    /// Max VRF fee per request the contract pays from revenue; the opener tops up anything above it.
    uint256 public maxVrfSubsidy;

    // Lifetime totals for the site
    uint256 public boxesSold;
    uint256 public boxesOpened;
    uint256 public cardsPaid;
    uint256 public cardsRefunded;
    uint256 public vrfFeesPaid;
    mapping(address => uint256) public paidOut;

    // Treasury policy: owner-set, operator-bound
    address public operator;
    IPriceSource public priceSource;
    uint16 public payoutMinBps = 7000;
    uint16 public payoutMaxBps = 8000;
    mapping(address => bool) public sinks;
    uint256 public dailyCap;
    uint256 public spentDay;
    uint256 public spentToday;

    // ------------------------------------------------------------------ events

    event Played(address indexed player, uint256 boxes, uint256 paid);
    event Gifted(address indexed from, address indexed to, uint256 boxes);
    event Opened(
        uint256 indexed openingId,
        uint256 indexed requestId,
        address indexed opener,
        uint256 boxes,
        uint256 tableId,
        uint256 vrfFee
    );
    event Rerequested(
        uint256 indexed openingId, uint256 indexed oldRequestId, uint256 indexed newRequestId, uint256 vrfFee
    );
    event Fulfilled(uint256 indexed openingId, uint256 indexed requestId, bytes32 word);
    event CardDrawn(
        uint256 indexed openingId,
        address indexed opener,
        address indexed token,
        uint256 boxIndex,
        uint256 cardIndex,
        uint256 amount,
        uint8 tier,
        uint256 prizeIndex,
        bool paid
    );
    event Refunded(
        uint256 indexed openingId, address indexed opener, uint256 boxIndex, uint256 cardIndex, uint256 amount
    );
    event Revealed(uint256 indexed openingId, address indexed opener, uint256 cardsPaid, uint256 refund);
    event BoxesReturned(uint256 indexed openingId, address indexed opener, uint256 boxes);
    event LinkCreated(
        uint256 indexed linkId, address indexed sender, address indexed linkKey, uint256 boxes, uint64 expiresAt
    );
    event LinkClaimed(uint256 indexed linkId, address indexed sender, address indexed recipient, uint256 boxes);
    event LinkReclaimed(uint256 indexed linkId, address indexed sender, uint256 boxes);
    event CreditAdded(address indexed to, uint256 amount);
    event CreditClaimed(address indexed to, uint256 amount);
    event PrizesSet(uint256 indexed tableId, uint256 count, uint256 totalWeight, address by);
    event OperatorSet(address operator);
    event PolicySet(address priceSource, uint16 payoutMinBps, uint16 payoutMaxBps, uint256 dailyCap);
    event SinkSet(address sink, bool allowed);
    event Spent(address indexed sink, address indexed stock, uint256 amount, uint256 sharesOut);
    event VrfConfigSet(uint32 callbackGasLimit, uint256 maxVrfSubsidy);
    event BoxPriceSet(uint256 price);

    // ------------------------------------------------------------------ errors

    error ZeroAmount();
    error WrongPayment();
    error TooManyBoxes();
    error NoPrizes();
    error BadPrize(uint256 index);
    error NotPending();
    error NotReady();
    error NotExpired();
    error AlreadyFulfilled();
    error NotOpener();
    error UnexpectedCallback();
    error VrfFeeTopUp(uint256 required, uint256 sent);
    error TransferFailed();
    error NotOperator();
    error PayoutOutOfBand(uint256 payoutBps);
    error NoPriceSource();
    error NotSink();
    error OverDailyCap();
    error Slippage(uint256 got, uint256 minOut);
    error BadBand();
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

    constructor(uint256 boxPrice_, string memory uri_, address coordinator_, uint256 maxVrfSubsidy_)
        ERC1155(uri_)
        Ownable(msg.sender)
        EIP712("arclaw", "1")
        D20Randomness(coordinator_)
    {
        if (boxPrice_ == 0) revert ZeroAmount();
        boxPrice = boxPrice_;
        maxVrfSubsidy = maxVrfSubsidy_;
    }

    // ================================================================== players

    /// @notice One play = one sealed box. Pay exactly `boxes * boxPrice`.
    function play(uint256 boxes) external payable whenNotPaused nonReentrant {
        if (boxes == 0) revert ZeroAmount();
        if (msg.value != boxes * boxPrice) revert WrongPayment();
        boxesSold += boxes;
        emit Played(msg.sender, boxes, msg.value);
        _mint(msg.sender, BOX, boxes, "");
    }

    /// @notice One sealed box to each recipient.
    function gift(address[] calldata recipients) external nonReentrant {
        for (uint256 i; i < recipients.length; ++i) {
            emit Gifted(msg.sender, recipients[i], 1);
            _safeTransferFrom(msg.sender, recipients[i], BOX, 1, "");
        }
    }

    /// @notice Burn `boxes` sealed boxes and request one random word for all of them.
    /// @dev The contract pays the VRF fee up to `maxVrfSubsidy`; above that the caller tops up via msg.value.
    ///      Overpayment is returned. Quote off-chain with coordinator.quoteFeeAt(callbackGasLimit, baseFee).
    function open(uint256 boxes) external payable whenNotPaused nonReentrant returns (uint256 openingId, uint256 requestId) {
        if (boxes == 0) revert ZeroAmount();
        if (boxes > MAX_BOXES_PER_OPEN) revert TooManyBoxes();
        if (_tables.length == 0) revert NoPrizes();

        _burn(msg.sender, BOX, boxes);
        openingId = nextOpeningId++;
        boxesOpened += boxes;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 tableId = uint32(_tables.length - 1); // one table per tx, never near 2^32
        openings[openingId] = Opening({
            opener: msg.sender,
            // forge-lint: disable-next-line(unsafe-typecast)
            boxes: uint32(boxes), // <= MAX_BOXES_PER_OPEN
            tableId: tableId,
            status: OpeningStatus.Pending,
            refundPerCard: SafeCast.toUint128(boxPrice / CARDS_PER_BOX),
            requestedAt: uint64(block.timestamp),
            requestId: 0,
            word: bytes32(0)
        });

        uint256 fee;
        (requestId, fee) = _request(openingId);
        openings[openingId].requestId = requestId;
        openingOfRequest[requestId] = openingId + 1;
        emit Opened(openingId, requestId, msg.sender, boxes, tableId, fee);
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
        // Effects before any token or native transfer.
        o.status = OpeningStatus.Revealed;
        o.word = word;
        delete openingOfRequest[o.requestId];

        Opening memory m = o;
        (uint256 paid, uint256 refund) = _payPack(openingId, m, word);
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
        emit BoxesReturned(openingId, msg.sender, boxes);
        _mint(msg.sender, BOX, boxes, "");
    }

    /// @notice Pull native USDC that could not be pushed (the receiver rejected it).
    function claimCredit() external nonReentrant {
        uint256 amount = credit[msg.sender];
        if (amount == 0) revert NoCredit();
        credit[msg.sender] = 0;
        emit CreditClaimed(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ================================================================== claim links

    /// @notice Escrow `boxes` under an ephemeral public key. Share the private key off-chain (in the link).
    function createLink(address linkKey, uint32 boxes, uint64 expiresAt)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 linkId)
    {
        if (linkKey == address(0) || boxes == 0 || expiresAt <= block.timestamp) revert BadLink();
        if (linkKeyUsed[linkKey]) revert LinkKeyUsed();
        linkKeyUsed[linkKey] = true;
        linkId = nextLinkId++;
        links[linkId] = Link(msg.sender, boxes, expiresAt, LinkStatus.Open, linkKey);
        escrowedBoxes += boxes;
        // Plain move into this contract's own balance: no receiver hook, and since this contract is not an
        // ERC1155Receiver nobody else can push boxes in, so balanceOf(this) == escrowedBoxes.
        _update(msg.sender, address(this), _one(BOX), _one(boxes));
        emit LinkCreated(linkId, msg.sender, linkKey, boxes, expiresAt);
    }

    /// @notice Claim a link for `recipient`. `signature` is the link key's EIP-712 signature over
    ///         Claim(linkId, recipient) in this contract's domain (name "arclaw", version "1", chainId, address).
    ///         Anyone may relay it; a front-runner can only deliver the boxes to the same recipient.
    function claimLink(uint256 linkId, address recipient, bytes calldata signature) external nonReentrant {
        Link storage l = links[linkId];
        if (l.status != LinkStatus.Open) revert LinkNotOpen();
        if (block.timestamp > l.expiresAt) revert LinkExpired();
        if (recipient == address(0)) revert BadLink();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, linkId, recipient)));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer != l.linkKey) revert BadSignature();

        l.status = LinkStatus.Claimed;
        uint256 boxes = l.boxes;
        escrowedBoxes -= boxes;
        emit LinkClaimed(linkId, l.sender, recipient, boxes);
        _safeTransferFrom(address(this), recipient, BOX, boxes, "");
    }

    /// @notice After expiry the sender takes unclaimed boxes back.
    function reclaimLink(uint256 linkId) external nonReentrant {
        Link storage l = links[linkId];
        if (l.status != LinkStatus.Open) revert LinkNotOpen();
        if (msg.sender != l.sender) revert NotSender();
        if (block.timestamp <= l.expiresAt) revert LinkNotExpired();
        l.status = LinkStatus.Reclaimed;
        uint256 boxes = l.boxes;
        escrowedBoxes -= boxes;
        emit LinkReclaimed(linkId, msg.sender, boxes);
        _safeTransferFrom(address(this), msg.sender, BOX, boxes, "");
    }

    /// @notice The digest a link key signs (for off-chain tooling and tests).
    function claimDigest(uint256 linkId, address recipient) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, linkId, recipient)));
    }

    // ================================================================== views

    function prizes() external view returns (Prize[] memory) {
        if (_tables.length == 0) return new Prize[](0);
        return _tables[_tables.length - 1];
    }

    function prizeTable(uint256 tableId) external view returns (Prize[] memory) {
        return _tables[tableId];
    }

    function tableCount() external view returns (uint256) {
        return _tables.length;
    }

    function totalWeight() external view returns (uint256) {
        return _tables.length == 0 ? 0 : _tableWeight[_tables.length - 1];
    }

    function tableWeight(uint256 tableId) external view returns (uint256) {
        return _tableWeight[tableId];
    }

    /// @notice Current exact VRF fee for one open (valid inside a transaction; via eth_call the base fee may read 0).
    function quoteVrfFee() external view returns (uint256) {
        return _quoteRandomness(callbackGasLimit);
    }

    /// @notice Expected payout of a table per box (3 cards), in bps of boxPrice, priced by `priceSource`.
    function payoutBps(Prize[] calldata table) public view returns (uint256) {
        if (address(priceSource) == address(0)) revert NoPriceSource();
        uint256 w;
        uint256 value; // sum of weight * card value, USD 18 dp (same units as boxPrice)
        for (uint256 i; i < table.length; ++i) {
            Prize calldata p = table[i];
            w += p.weight;
            uint256 usd18 =
                p.amount * priceSource.priceOf(p.token) * 1e12 / 10 ** IERC20Metadata(p.token).decimals();
            value += usd18 * p.weight;
        }
        if (w == 0) revert NoPrizes();
        return value * CARDS_PER_BOX * 10_000 / w / boxPrice;
    }

    // ================================================================== operator

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @notice Reprice the table; lands only if the expected payout per box is inside the owner's band.
    function operatorSetPrizes(Prize[] calldata table) external onlyOperator {
        uint256 bps = payoutBps(table);
        if (bps < payoutMinBps || bps > payoutMaxBps) revert PayoutOutOfBand(bps);
        _pushTable(table);
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

    /// @notice Owner override, no band check (the owner sets the band).
    function setPrizes(Prize[] calldata table) external onlyOwner {
        _pushTable(table);
    }

    function setOperator(address op) external onlyOwner {
        operator = op;
        emit OperatorSet(op);
    }

    function setPolicy(IPriceSource source, uint16 minBps, uint16 maxBps, uint256 cap) external onlyOwner {
        if (minBps > maxBps) revert BadBand();
        (priceSource, payoutMinBps, payoutMaxBps, dailyCap) = (source, minBps, maxBps, cap);
        emit PolicySet(address(source), minBps, maxBps, cap);
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

    function setBoxPrice(uint256 price) external onlyOwner {
        if (price == 0) revert ZeroAmount();
        boxPrice = price;
        emit BoxPriceSet(price);
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

    /// Pays the fee (subsidised up to maxVrfSubsidy, caller tops up the rest) and returns any change.
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

    function _payPack(uint256 openingId, Opening memory m, bytes32 word)
        internal
        returns (uint256 paid, uint256 refund)
    {
        Prize[] storage table = _tables[m.tableId];
        uint256 w = _tableWeight[m.tableId];
        for (uint256 b; b < m.boxes; ++b) {
            for (uint256 c; c < CARDS_PER_BOX; ++c) {
                uint256 idx = _draw(table, w, uint256(keccak256(abi.encode(word, b, c))));
                Prize memory p = table[idx];
                bool ok = _balanceOf(p.token) >= p.amount && IERC20(p.token).trySafeTransfer(m.opener, p.amount);
                emit CardDrawn(openingId, m.opener, p.token, b, c, p.amount, p.tier, idx, ok);
                if (ok) {
                    ++paid;
                    paidOut[p.token] += p.amount;
                } else {
                    refund += m.refundPerCard;
                    emit Refunded(openingId, m.opener, b, c, m.refundPerCard);
                }
            }
        }
    }

    function _draw(Prize[] storage table, uint256 w, uint256 rand) internal view returns (uint256) {
        uint256 r = rand % w;
        uint256 n = table.length;
        for (uint256 i; i < n; ++i) {
            uint256 wi = table[i].weight;
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

    function _pushTable(Prize[] calldata table) internal {
        if (table.length == 0) revert NoPrizes();
        Prize[] storage t = _tables.push();
        uint256 w;
        for (uint256 i; i < table.length; ++i) {
            Prize calldata p = table[i];
            if (p.token == address(0) || p.amount == 0 || p.weight == 0) revert BadPrize(i);
            t.push(p);
            w += p.weight;
        }
        _tableWeight.push(w);
        emit PrizesSet(_tables.length - 1, table.length, w, msg.sender);
    }

    /// Push native USDC; if the receiver rejects it, keep it as pull credit so reveal can never be blocked.
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
