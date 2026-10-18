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
///         sealed box of that machine. Opening burns boxes and asks the VRF for one word; once it lands the opener
///         (or a keeper; anyone after an hour) can `reveal`, which draws ONE weighted outcome per box (a pack of 3
///         cards) from the machine's table frozen at open time and pays the cards from inventory. A card the
///         inventory cannot cover is first bought just in time on the allow-listed desk with box revenue; only if
///         that is off or fails is it refunded in USDC at the lower of its value when the table was set and its
///         value at the latest price read. Refunds come only from the unreserved balance; the rest is an IOU.
///         Every table, whoever sets it, must satisfy the machine's rules: each outcome worth at least floorBps and
///         at most capBps of the price, and the weighted expected value inside [rtpMinBps, rtpMaxBps]. At open the
///         table is checked again at live prices: every card within maxPriceMoveBps of its table price and the smallest
///         pack still worth floorBps; rtpMax leaves room for that move under MAX_RTP_BPS.
///         Trust: the box price is reserved, the prize stock is not. The word is public once fulfilled, so the owner
///         could see a big pack coming, sweep its stock and withdraw the free balance before the reveal; the winner
///         then gets an IOU (owed), paid as revenue frees up. Owner keys belong in a multisig.
///
///         VRF withholding (red team H1). D20 on Arc: one fixed operator key proves every word over the request's
///         fixed fields (chain, coordinator, key hash, requestId, consumer, clientSeed, request and target block,
///         target block hash, epoch). The key holder cannot change a word but can withhold it: an unproven request
///         expires after 60 s, nothing is accepted late, and the word is never published nor computable by anyone
///         else. Anyone can relay a proof, only the key holder can make one. A new request has a new requestId, so it
///         is a new independent word whatever the seed: reusing the seed (done here, keccak(this, openingId)) does
///         not pin the draw. D20 therefore cannot give a withholding-proof guarantee. Whoever can stop a proof from
///         landing in time (the D20 key holder, or an Arc validator censoring the fulfil transaction, which shows the
///         word about a block early) and also holds the opening can drop bad words and take best-of-N: per box
///         Single 91.1 / 103.4%, Stack 96.6 / 108.2%, Vault 101.0 / 111.4% at N = 2 / 3. The player alone cannot.
///         Bounds here: an opening gets at most MAX_RETRIES re-requests (best-of-2); every expired request that is
///         retried or returned counts as a miss, and limits.maxMisses misses in a UTC day pause the contract (no new
///         opens; each pending opening keeps at most its one retry). returnBoxes + reopen is not a free loop: it
///         needs an expired request (a miss), the pinned table aged out (up to maxTableAge, 1 day by default), and a
///         new open, which the breaker stops. Residual: up to about maxMisses re-rolls a day, worth on average about
///         0.16 x price each (Vault single box, best-of-2 minus 0.85), so with the default 10 about 16 USDC a day on
///         Vault before the breaker pauses, plus one retry per opening still pending then. Monitor expiries.
contract Arclaw is ERC1155, Ownable2Step, Pausable, ReentrancyGuard, D20Randomness {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants

    uint256 public constant CARDS_PER_BOX = 3;
    uint256 public constant MAX_BOXES_PER_OPEN = 20;
    uint256 public constant MAX_OUTCOMES = 64; // bounds setPrizes gas and the reveal draw scan (ArclawRules)
    /// Luck boost ceiling: with probability boost/10000 a box draws twice and keeps the better pack. Every table's
    /// RTP band is checked at this maximum, so no holder can push a machine past rtpMaxBps.
    uint256 public constant MAX_BOOST_BPS = 100;
    uint32 public constant MIN_CALLBACK_GAS = 30_000; // D20 bounds
    uint32 public constant MAX_CALLBACK_GAS = 1_000_000;
    /// Sanity bounds on the owner's per-machine rules.
    uint16 public constant MIN_FLOOR_BPS = 5000; // never less than 50% back (the product promise)
    /// House edge never under 5%, even after the largest allowed price move. Cap and RTP are checked at the prices a
    /// table was set at; open only re-checks the floor and that every card moved at most maxPriceMoveBps (<= 5%).
    /// So live values can exceed them by that move: a pack built at 9.9x can pay about 10.4x, a table at the 8800
    /// rtpMax about 92.4%, and the Vault table (85.2% at max boost) up to about 89.5%. rtpMax * 1.05 <= 9500 keeps it
    /// under 95% in every case. The cap is a table-time bound, not a live one.
    uint16 public constant MAX_RTP_BPS = 9500;
    uint32 public constant MAX_CAP_BPS = 1_000_000; // 100x
    uint256 internal constant MAX_TABLE_AGE = 1 days; // upper bound for maxTableAge
    /// Upper bound for maxPriceMoveBps; setMachine keeps rtpMax * (1 + this) <= MAX_RTP_BPS (rtpMax <= 9047).
    uint256 internal constant MAX_PRICE_MOVE_BPS = 500;
    /// Sealed boxes of a machine that is off, or whose table went stale, or of a paused contract, this long can be
    /// refunded at their price.
    uint256 internal constant SEALED_REFUND_AFTER = 3 days;
    /// Reveal is the opener's (or a keeper's) for this long after the request, then anyone's.
    uint256 internal constant PUBLIC_REVEAL_AFTER = 1 hours;
    /// An opening still unrevealed this long after its request can be rescued (see rescue).
    uint256 internal constant RESCUE_AFTER = 7 days;
    /// Gas forwarded on pushed native payments; a receiver that needs more gets pull credit instead.
    uint256 internal constant PUSH_GAS = 100_000;
    /// Arc's USDC ERC-20 view: the same balance as native USDC, never a card and never sweepable.
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    /// Re-requests per opening after its VRF request expired (see the withholding note above).
    uint256 internal constant MAX_RETRIES = 1;
    /// An off machine or a paused contract keeps its refundSealed clock until back in service this long.
    uint256 internal constant SERVICE_RESET = 1 days;
    /// Gas given to the VRF probe in pauseIfVrfDown (a D20 request stores one 17-word record).
    uint256 internal constant PROBE_GAS = 1_000_000;

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
    /// open() refuses a table once any card's live price moved more than this from the price it was set at.
    uint256 public maxPriceMoveBps = 500;
    /// tableId => card token => USD price (6 dp) the table was set at
    mapping(uint256 => mapping(address => uint256)) internal tableRefPrice;
    /// tableId => distinct card tokens, checked against tableRefPrice at open
    mapping(uint256 => address[]) internal _tableTokens;
    /// card token => last price this contract read successfully (USD 6 dp); caps refunds behind a stale feed
    mapping(address => uint256) public lastPrice;
    /// machineId => when the owner switched it off (0 = on). Off: no new plays or opens; reveals, returns, links and
    /// refundSealed keep working. machineOff(id) reads it as a bool.
    mapping(uint256 => uint256) public offSince;
    /// machineId => refundSealed clock of the off state: set at switch-off, kept across a switch back on until the
    /// machine has been on SERVICE_RESET (so on+off in one batch cannot restart it). onSince: last switch-on.
    mapping(uint256 => uint256) internal offClock;
    mapping(uint256 => uint256) internal onSince;
    /// refundSealed clock of the paused state: set by a pause (owner, guardian, the automatic ones), kept after
    /// unpause until the contract has run SERVICE_RESET without a pause. 0 = never paused.
    uint256 public pausedSince;
    /// Last unpause.
    uint256 public resumedAt;
    /// May pause (never unpause); a hot keeper-style key is fine.
    address public guardian;

    mapping(uint256 => Opening) public openings;
    /// requestId => openingId + 1 (0 = unknown or superseded)
    mapping(uint256 => uint256) public openingOfRequest;
    uint256 public nextOpeningId;

    mapping(address => uint256) public credit;
    /// Liabilities the owner and operator cannot touch (see freeBalance): owed credit, the price paid for every
    /// box still waiting to be revealed or returned, and the price paid for every sold box not yet opened.
    uint256 public reservedCredit;
    uint256 public pendingReserve;
    uint256 public sealedReserve;
    /// Refunds a reveal could not cover from the unreserved balance: IOUs, claimable as the pool refills.
    mapping(address => uint256) public owed;
    uint256 public totalOwed;
    /// After a reveal, any IOU or an unreserved balance under this pauses new plays and opens (0 = IOUs only).
    uint256 public minBuffer;
    /// May reveal any opening right away (openers may always reveal their own).
    mapping(address => bool) public keepers;

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

    /// ARCLAW staking vault read at open (0 = boosts off).
    ILuck public luck;
    /// openingId => luck boost (bps) fixed at open
    mapping(uint256 => uint256) public openingBoost;
    /// openingId => VRF fee the opener paid above the subsidy for the live request; paid back if it expires.
    mapping(uint256 => uint256) public openingTopUp;
    /// Sum of openingTopUp of live requests: reserved (out of freeBalance) from the open until the request is
    /// revealed or its top-up paid back, wherever D20's refund lands meanwhile.
    uint256 public topUpReserve;
    /// openingId => re-requests made (<= MAX_RETRIES)
    mapping(uint256 => uint256) public openingRetries;

    /// Daily limits, UTC day: JIT desk spend (jitCap, native wei) and VRF misses (expired requests retried or
    /// returned) before the contract pauses itself (maxMisses).
    struct Limits {
        uint32 day;
        uint16 misses;
        uint16 maxMisses;
        uint96 jitCap;
        uint96 jitSpent;
    }

    Limits public limits = Limits(0, 0, 10, 2000 ether, 0);

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
    event SealedRefunded(address indexed holder, uint256 indexed machineId, uint256 boxes, uint256 amount);
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
    event RefundOwed(address indexed to, uint256 amount);
    event OwedClaimed(address indexed to, uint256 amount);
    event KeeperSet(address keeper, bool allowed);
    event GuardsSet(uint256 maxPriceMoveBps, uint256 minBuffer);
    event GuardianSet(address guardian);
    event LimitsSet(uint256 jitDailyCap, uint256 maxMissesPerDay);

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
    error TableStale();
    error BadGas();
    error NoCredit();
    error Reserved(uint256 free);
    error RenounceDisabled();
    error TableChanged();
    error RuleLowered();
    error UsdcAlias();
    error WeightTooHigh(uint256 total);
    error RetryLimit();
    error NotGuardian();
    error VrfAlive();

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
        if (offSince[machineId] != 0) revert MachineOff();
        if (boxes == 0) revert ZeroAmount();
        if (msg.value != boxes * price) revert WrongPayment();
        boxesSold[machineId] += boxes;
        sealedReserve += msg.value; // backs the sealed box until it is opened
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

    /// @notice Burn `boxes` of `machineId` and request one random word for all of them. `tableId` is the table the
    ///         player was shown (currentTable - 1): a reprice landing first makes the open revert, never re-rate it.
    /// @dev The contract pays the VRF fee up to `maxVrfSubsidy`; above that the caller tops up via msg.value (paid back
    ///      if the request expires). Every card needs a live price: an oracle outage (Astock stale on weekends and
    ///      holidays, an unmapped token) halts opens of the machine until the feed returns, while reveals go on with
    ///      lastPrice and sealed boxes keep refundSealed once the table has been stale for SEALED_REFUND_AFTER.
    function open(uint256 machineId, uint256 boxes, uint256 tableId)
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
        if (t - 1 != tableId) revert TableChanged();
        if (offSince[machineId] != 0) revert MachineOff();
        // tablePrice == machine price: the price is immutable per machine and every table is set at it
        _checkTable(tableId);

        _burn(msg.sender, machineId, boxes);
        openingId = nextOpeningId++;
        boxesOpened += boxes;
        uint256 cost = boxes * tablePrice[tableId]; // == machine price: sealed revenue becomes pending
        sealedReserve -= cost;
        pendingReserve += cost;
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

    /// @notice Pay out a fulfilled opening; cards always go to the opener. The opener or a keeper may call at once,
    ///         anyone PUBLIC_REVEAL_AFTER the request (so an opener who disappears cannot strand the reserve), which
    ///         keeps third parties from timing someone else's reveal around their own opens.
    /// @dev Works even if the VRF callback failed: the word is then read from the coordinator.
    function reveal(uint256 openingId) external nonReentrant {
        Opening storage o = openings[openingId];
        if (msg.sender != o.opener && !keepers[msg.sender] && block.timestamp < o.requestedAt + PUBLIC_REVEAL_AFTER) {
            revert NotOpener();
        }
        _reveal(openingId, false);
    }

    /// @notice Escape for a fulfilled opening whose reveal keeps failing (a card token or desk that reverts or burns
    ///         gas): RESCUE_AFTER its request the opener or a keeper settles it with every card paid in USDC at its
    ///         refund value, never touching the card tokens. Not the box price: the word is public once fulfilled,
    ///         so a price refund would let holders sit on bad draws. A refund value is never more than the stock, so
    ///         waiting never beats revealing. An opening the VRF never answered has retry and returnBoxes.
    function rescue(uint256 openingId) external nonReentrant {
        Opening storage o = openings[openingId];
        if (msg.sender != o.opener && !keepers[msg.sender]) revert NotOpener();
        if (block.timestamp < o.requestedAt + RESCUE_AFTER) revert NotExpired();
        _reveal(openingId, true);
    }

    /// Settles a fulfilled opening; with `cash` (rescue) every card is paid at its refund value, no token touched.
    /// The draw and the card payouts run in ArclawPayout (code size), in this contract's context.
    function _reveal(uint256 openingId, bool cash) internal {
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
        uint256 topUp = openingTopUp[openingId]; // the request was served: D20 kept the fee, release the reserve
        if (topUp != 0) {
            topUpReserve -= topUp;
            delete openingTopUp[openingId];
        }

        Opening memory m = o;
        (uint256 paid, uint256 refund) = ArclawPayout.pay(
            _tables[m.tableId],
            jit,
            limits,
            sinks,
            tableRefPrice[m.tableId],
            lastPrice,
            paidOut,
            ArclawPayout.Ctx(
                openingId,
                m.opener,
                m.machineId,
                m.boxes,
                word,
                openingBoost[openingId],
                tableWeight[m.tableId],
                reservedCredit + pendingReserve + sealedReserve + totalOwed + topUpReserve,
                priceSource,
                cash
            )
        );
        cardsPaid += paid;
        cardsRefunded += uint256(m.boxes) * CARDS_PER_BOX - paid;
        emit Revealed(openingId, m.opener, paid, refund);
        _settle(m.opener, refund, _unreserved());
    }

    /// @notice The request expired unfulfilled (D20: 60 s). Ask again; the boxes stay committed. Only while the pinned
    ///         table could still be opened (fresh, every card within maxPriceMoveBps, floor held at live prices), so
    ///         a stale table is never revived; past that only returnBoxes remains. The expired fee is reclaimed first
    ///         and the opener's top-up paid back. The opener, a keeper and the operator retry on the house subsidy;
    ///         anyone else pays the full fee (and loses it if that request expires too).
    ///         Keeper-first: the house bot retries every expired opening at once, so the opener never gets to wait
    ///         and pick between retry and returnBoxes depending on where prices went.
    ///         At most MAX_RETRIES per opening, and each counts as a VRF miss (the daily breaker, see the contract
    ///         note): a withheld word can buy at most one fresh draw per opening. Past that, returnBoxes.
    function retry(uint256 openingId) external payable nonReentrant returns (uint256 requestId) {
        Opening storage o = openings[openingId];
        if (o.status != OpeningStatus.Pending) revert NotPending();
        if (openingRetries[openingId]++ >= MAX_RETRIES) revert RetryLimit();
        uint256 old = o.requestId;
        _requireExpired(old);
        _checkTable(o.tableId);
        _miss();
        delete openingOfRequest[old];
        _refundRandomness(old);
        uint256 back = openingTopUp[openingId];
        topUpReserve -= back;

        uint256 fee;
        address opener = o.opener;
        (requestId, fee) = _request(openingId, msg.sender == opener || keepers[msg.sender] || msg.sender == operator);
        o.requestId = requestId;
        o.requestedAt = uint64(block.timestamp);
        openingOfRequest[requestId] = openingId + 1;
        emit Rerequested(openingId, old, requestId, fee);
        if (back != 0) _payTopUp(opener, back);
    }

    /// @notice The request expired unfulfilled: the opener takes the sealed boxes back (and any VRF top-up) instead of
    ///         a retry. Only once the pinned table has aged out (maxTableAge): until then the keeper retries, so taking
    ///         the boxes back never depends on a price move the opener has watched. RESCUE_AFTER the request, a
    ///         coordinator whose status read reverts or reports no deadline counts as expired, so a dead VRF never
    ///         strands the boxes (the pinned table aged out long before: maxTableAge <= 1 day).
    ///         An expired request returned here counts as a VRF miss, like a retry: return + reopen is a re-roll, so
    ///         it is gated by the table age and the daily breaker, not free.
    ///         The top-up comes back from topUpReserve; if D20 refunded less (refundBps >= 50%) and the unreserved
    ///         balance cannot make up the rest, the rest is an IOU (owed), never unbacked credit.
    function returnBoxes(uint256 openingId) external nonReentrant {
        Opening storage o = openings[openingId];
        if (o.status != OpeningStatus.Pending) revert NotPending();
        if (msg.sender != o.opener) revert NotOpener();
        uint256 req = o.requestId;
        if (block.timestamp <= o.requestedAt + RESCUE_AFTER || !_randomnessLost(req)) {
            _requireExpired(req);
            if (block.timestamp <= tablePricedAt[o.tableId] + maxTableAge) revert NotExpired();
            _miss();
        }
        o.status = OpeningStatus.Returned;
        delete openingOfRequest[req];
        _refundRandomness(req);
        uint256 boxes = o.boxes;
        boxesOpened -= boxes;
        uint256 cost = boxes * tablePrice[o.tableId];
        pendingReserve -= cost;
        sealedReserve += cost; // sealed again
        uint256 back = openingTopUp[openingId];
        delete openingTopUp[openingId];
        topUpReserve -= back;
        emit BoxesReturned(openingId, msg.sender, o.machineId, boxes);
        _mint(msg.sender, o.machineId, boxes, "");
        if (back != 0) _payTopUp(msg.sender, back);
    }

    /// @notice Exit for sealed boxes of a machine that stopped serving them: switched off, its table stale (not
    ///         repriced in time), or the contract paused, for SEALED_REFUND_AFTER. Burns `boxes` and pays back their
    ///         price (fixed per machine, so exactly what was paid). Works while paused.
    /// @dev The clock starts at the earliest of the three (see sealedRefundAt), so toggling the machine cannot restart
    ///      it while a pause or a stale table is running, and neither unpause nor a switch back on restarts the pause
    ///      or off clock until the contract / machine has been back in service SERVICE_RESET (1 day).
    function refundSealed(uint256 machineId, uint256 boxes) external nonReentrant {
        if (boxes == 0) revert ZeroAmount();
        if (block.timestamp < sealedRefundAt(machineId)) revert NotExpired();
        uint256 amount = boxes * machines[machineId].price;
        _burn(msg.sender, machineId, boxes);
        sealedReserve -= amount;
        emit SealedRefunded(msg.sender, machineId, boxes, amount);
        _sendNative(msg.sender, amount);
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
        _pay(to, amount);
    }

    /// @notice Pull an IOU (a refund a reveal could not cover), as far as the balance above every other reserve
    ///         allows right now; the rest stays owed. First come, first served.
    function claimOwed(address to) external nonReentrant {
        uint256 bal = address(this).balance;
        uint256 res = reservedCredit + pendingReserve + sealedReserve + topUpReserve;
        uint256 amount = owed[msg.sender];
        if (bal < res + amount) amount = bal > res ? bal - res : 0;
        if (amount == 0) revert NoCredit();
        owed[msg.sender] -= amount;
        totalOwed -= amount;
        emit OwedClaimed(msg.sender, amount);
        _pay(to, amount);
    }

    /// @notice Dead-VRF exit (audit 6a/6b L-02), anyone may call. Tries a real VRF request, quote and request each
    ///         with PROBE_GAS: if the request goes through the whole call reverts VrfAlive (so nothing is requested and
    ///         no fee spent); if the quote or the request reverts, the contract pauses, which stops plays and opens
    ///         and starts the refundSealed clock (sealed boxes refundable 3 days later). VrfAlive too when the balance
    ///         cannot pay one fee (no proof either way: the guardian pauses).
    ///         Runbook, VRF down: (1) anyone (the keeper bot first) calls this, or the guardian pauses; (2) expired
    ///         openings: the keeper retries once if D20 recovers, else openers returnBoxes once their table aged out
    ///         (7 days after the request if getRequest itself reverts); (3) the owner unpauses only after D20 serves
    ///         again (pauseIfVrfDown reverts VrfAlive, a test open is fulfilled); the pause clock keeps running until
    ///         one full day of service, so a re-pause the same day does not restart it; (4) the coordinator is
    ///         immutable: if D20 is gone for good, stay paused, let holders refundSealed and deploy a new Arclaw.
    function pauseIfVrfDown() external whenNotPaused {
        // the probe gets PROBE_GAS per call: starving it proves nothing
        if (gasleft() < PROBE_GAS + 100_000 || !_randomnessDown(callbackGasLimit, PROBE_GAS)) revert VrfAlive();
        _pause();
    }

    // ================================================================== views

    /// @notice When sealed boxes of `machineId` become refundable at their price (refundSealed): 3 days after the
    ///         earliest of: its table went stale (no table: at once), it was switched off, the contract was paused.
    ///         The off and pause clocks keep counting until the machine / contract has been back in service 1 day.
    function sealedRefundAt(uint256 machineId) public view returns (uint256) {
        uint256 t = currentTable[machineId];
        uint256 since = t == 0 ? 0 : tablePricedAt[t - 1] + maxTableAge;
        return ArclawRules.refundAt(offSince, offClock, onSince, machineId, since, pausedSince, resumedAt, paused());
    }

    function machineIds() external view returns (uint256[] memory) {
        return _machineIds;
    }

    /// @notice True while the owner has the machine switched off (see offSince).
    function machineOff(uint256 machineId) external view returns (bool) {
        return offSince[machineId] != 0;
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

    /// @notice Native balance above owed credit, pending and sealed boxes, IOUs and the reserve floor: what withdraw
    ///         and spend may use.
    function freeBalance() public view returns (uint256) {
        uint256 u = _unreserved();
        return u > reserveFloor ? u - reserveFloor : 0;
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
    ///         Rules apply to tables set from now on; the current table keeps serving until replaced (except the floor,
    ///         which open checks at live prices).
    ///         Bounds: floor >= MIN_FLOOR_BPS, floor <= rtpMin <= rtpMax <= cap <= MAX_CAP_BPS, and
    ///         rtpMax * (1 + MAX_PRICE_MOVE_BPS) <= MAX_RTP_BPS, so a table opened at the largest allowed price move
    ///         still keeps a positive house edge.
    ///         Once a machine exists, floor and rtpMin only move up: they are what a sold box was promised. Cap and
    ///         rtpMax may move either way inside the bounds; with floor and rtpMin locked, a lower one only narrows
    ///         the tables and a higher one only allows rarer, bigger packs at the same guaranteed minimums.
    function setMachine(
        uint256 machineId,
        uint128 price,
        uint16 floorBps,
        uint32 capBps,
        uint16 rtpMinBps,
        uint16 rtpMaxBps
    ) external onlyOwner {
        ArclawRules.setMachine(machines, _machineIds, machineId, Machine(price, floorBps, capBps, rtpMinBps, rtpMaxBps));
    }

    /// @notice Stop or resume new plays and opens on a machine (reveals, returns and links continue).
    function setMachineActive(uint256 machineId, bool active) external onlyOwner {
        if (machines[machineId].price == 0) revert UnknownMachine();
        ArclawRules.setActive(offSince, offClock, onSince, machineId, active);
    }

    /// @notice The ARCLAW staking vault (LuckVault). Zero turns boosts off for new opens.
    function setLuck(ILuck vault) external onlyOwner {
        luck = vault;
        emit LuckSet(address(vault));
    }

    /// @notice Keepers may reveal any opening at once and rescue stuck ones (the house's reveal bot).
    function setKeeper(address keeper, bool allowed) external onlyOwner {
        keepers[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    /// @notice Max live price move per card since its table was set (1 to MAX_PRICE_MOVE_BPS), and the unreserved
    ///         buffer under which a reveal pauses play.
    function setGuards(uint256 maxMoveBps, uint256 minBuffer_) external onlyOwner {
        if (maxMoveBps == 0 || maxMoveBps > MAX_PRICE_MOVE_BPS) revert BadMachine();
        (maxPriceMoveBps, minBuffer) = (maxMoveBps, minBuffer_);
        emit GuardsSet(maxMoveBps, minBuffer_);
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

    /// @notice How long a priced table may keep serving new opens before the operator must reprice it (<= 1 day).
    function setMaxTableAge(uint256 maxAge) external onlyOwner {
        if (maxAge == 0 || maxAge > MAX_TABLE_AGE) revert BadMachine();
        maxTableAge = maxAge;
        emit MaxTableAgeSet(maxAge);
    }

    function setURI(string calldata uri_) external onlyOwner {
        _setURI(uri_);
    }

    /// @notice The pause-only guardian (zero: none). It can pause, never unpause.
    function setGuardian(address g) external onlyOwner {
        guardian = g;
        emit GuardianSet(g);
    }

    /// @notice Daily JIT desk spend cap (native wei) and VRF misses per day before the automatic pause (>= 1).
    function setLimits(uint96 jitDailyCap, uint16 maxMissesPerDay) external onlyOwner {
        if (maxMissesPerDay == 0) revert BadMachine();
        (limits.jitCap, limits.maxMisses) = (jitDailyCap, maxMissesPerDay);
        emit LimitsSet(jitDailyCap, maxMissesPerDay);
    }

    /// @notice Owner or guardian.
    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _pause();
    }

    /// @notice Owner only. Does not clear pausedSince: that clock restarts only on a pause after a day of service.
    function unpause() external onlyOwner {
        resumedAt = block.timestamp;
        _unpause();
    }

    /// @notice Only the free balance: owed credit and pending openings stay backed.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        _requireFree(amount);
        _pay(to, amount);
    }

    /// @notice Move an ERC-20 out (inventory included). Never Arc's USDC view: on Arc it IS the native balance, which
    ///         only withdraw moves. Any other token that drains native still may not take more than the free balance.
    function sweep(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (token == USDC) revert UsdcAlias();
        (uint256 bal, uint256 free) = (address(this).balance, freeBalance());
        IERC20(token).safeTransfer(to, amount);
        if (bal > address(this).balance + free) revert Reserved(free);
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
        // only the opener's own top-up is paid back on expiry (reserved until then); anyone else's retry fee is
        // theirs to lose
        uint256 topUp = msg.sender == openings[openingId].opener ? required : 0;
        openingTopUp[openingId] = topUp;
        topUpReserve += topUp;
        vrfFeesPaid += fee;
        // Same seed on every request of an opening. D20 binds the requestId too, so a retry is still a new word:
        // the seed only labels the request (see the withholding note on the contract).
        requestId = _requestRandomness(keccak256(abi.encode(address(this), openingId)), gasLimit, fee);
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

    /// Luck boost of `player`, capped at MAX_BOOST_BPS. A missing, failing or non-conforming vault (an EOA, empty or
    /// short return data) means no boost, never a revert. The boost belongs to whoever calls open, so a staker can
    /// open other people's boxes for them (boost renting); accepted, the RTP band already holds at MAX_BOOST_BPS.
    function _boostOf(address player) internal view returns (uint256 bps) {
        bps = _readUint(address(luck), abi.encodeCall(ILuck.boostOf, (player)), 100_000);
        if (bps > MAX_BOOST_BPS) bps = MAX_BOOST_BPS;
    }

    /// staticcall returning one word; 0 on revert, no code, or fewer than 32 bytes back (never a decode revert).
    function _readUint(address target, bytes memory data, uint256 gasLimit) internal view returns (uint256 v) {
        bool ok;
        uint256 size;
        assembly ("memory-safe") {
            ok := staticcall(gasLimit, target, add(data, 0x20), mload(data), 0x00, 0x20)
            size := returndatasize()
            v := mload(0x00)
        }
        if (!ok || size < 32) v = 0;
    }

    /// open and retry: the table must be younger than maxTableAge, every card within maxPriceMoveBps of its table
    /// price (up, the table is a free option on the house; down, packs shrink) and every pack still worth the
    /// machine's floorBps at live prices (ArclawRules.check).
    function _checkTable(uint256 tableId) internal {
        if (block.timestamp > tablePricedAt[tableId] + maxTableAge) revert TableStale();
        Machine memory mc = machines[tableMachine[tableId]];
        ArclawRules.check(
            _tables[tableId],
            tableRefPrice[tableId],
            _tableTokens[tableId],
            lastPrice,
            priceSource,
            maxPriceMoveBps,
            mc.floorBps,
            mc.price
        );
    }

    /// The daily limits, rolled over to today (UTC) if a new day started.
    function _today() internal returns (Limits storage l) {
        l = limits;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 d = uint32(block.timestamp / 1 days);
        if (l.day != d) (l.day, l.misses, l.jitSpent) = (d, 0, 0);
    }

    /// An expired request was retried or returned: one VRF miss. maxMisses in a day pause the contract.
    function _miss() internal {
        Limits storage l = _today();
        if (++l.misses >= l.maxMisses && !paused()) _pause();
    }

    /// Pays an expired request's top-up (already taken out of topUpReserve) from the balance above the other reserves:
    /// it was reserved before any IOU opened, so it ranks ahead of IOUs. What the balance cannot cover (D20 refunded
    /// under 100% and there is no float) becomes an IOU, never unbacked credit.
    function _payTopUp(address to, uint256 amount) internal {
        uint256 bal = address(this).balance;
        uint256 res = reservedCredit + pendingReserve + sealedReserve + topUpReserve;
        _settle(to, amount, bal > res ? bal - res : 0);
    }

    /// Native above every reserve and IOU: what refunds and JIT buys may use (reserveFloor included).
    function _unreserved() internal view returns (uint256) {
        uint256 bal = address(this).balance;
        uint256 res = reservedCredit + pendingReserve + sealedReserve + totalOwed + topUpReserve;
        return bal > res ? bal - res : 0;
    }

    /// Pays `amount` to `to` out of `cover` (reveal refunds: the unreserved balance); what it cannot cover becomes an
    /// IOU (owed), so a big win never eats other players' reserves. Any IOU, or a buffer under minBuffer, pauses plays
    /// and opens.
    function _settle(address to, uint256 amount, uint256 cover) internal {
        if (amount > cover) {
            uint256 iou = amount - cover;
            owed[to] += iou;
            totalOwed += iou;
            emit RefundOwed(to, iou);
            amount = cover;
        }
        if (amount != 0) _sendNative(to, amount);
        if (!paused() && (totalOwed != 0 || _unreserved() < minBuffer)) _pause();
    }

    /// Every pause (owner, guardian, automatic) runs the sealed-refund clock. A pause within SERVICE_RESET of the
    /// last unpause keeps the running clock: unpause + pause in one batch cannot restart it.
    function _pause() internal override {
        if (pausedSince == 0 || block.timestamp >= resumedAt + SERVICE_RESET) pausedSince = block.timestamp;
        super._pause();
    }

    /// Validation and the outcome writes live in ArclawRules (code size); the per-table arrays stay here.
    function _setPrizes(uint256 machineId, OutcomeInput[] calldata input) internal {
        Machine memory mc = machines[machineId];
        if (mc.price == 0) revert UnknownMachine();
        if (address(priceSource) == address(0)) revert NoPriceSource();
        uint256 tableId = _tables.length;
        (uint256 rtpBps, uint256 w) =
            ArclawRules.store(_tables, tableRefPrice, _tableTokens, lastPrice, mc, priceSource, input);
        ArclawRules.record(tableWeight, tableMachine, tablePrice, tablePricedAt, w, machineId, mc.price);
        currentTable[machineId] = tableId + 1;
        emit PrizesSet(machineId, tableId, input.length, rtpBps, msg.sender);
    }

    /// Push native USDC with PUSH_GAS; if the receiver rejects it, needs more gas or the pool is short, keep it as
    /// pull credit so a reveal is never blocked. No returndata is copied and the gas is capped: a receiver answering
    /// with a huge revert (return bomb) or burning its gas costs the caller at most PUSH_GAS, so keeper and public
    /// reveals and rescue always settle.
    function _sendNative(address to, uint256 amount) internal {
        if (!_call(to, amount, PUSH_GAS)) _credit(to, amount);
    }

    function _credit(address to, uint256 amount) internal {
        credit[to] += amount;
        reservedCredit += amount;
        emit CreditAdded(to, amount);
    }

    /// Pays `amount` to `to` with all gas or reverts (claims and withdraw: the caller chose `to` and pays the gas).
    function _pay(address to, uint256 amount) internal {
        if (!_call(to, amount, gasleft())) revert TransferFailed();
    }

    /// Native transfer with `gasLimit` and no returndata copy, so a return bomb costs the caller nothing.
    function _call(address to, uint256 amount, uint256 gasLimit) internal returns (bool ok) {
        assembly ("memory-safe") {
            ok := call(gasLimit, to, amount, 0, 0, 0, 0)
        }
    }
}

/// @title ArclawRules: table validation and storage, an external library linked into Arclaw (24 KB code limit)
/// @notice Prices every card, enforces floor, cap and RTP band (checked at the maximum luck boost) and appends the
///         table, recording each card token's reference price for Arclaw's open-time price check. Reverts with
///         Arclaw's errors. Constants mirror Arclaw's (CARDS_PER_BOX 3, MAX_OUTCOMES 64, MAX_BOOST_BPS 100, USDC,
///         MIN_FLOOR_BPS 5000, MAX_RTP_BPS 9500, MAX_CAP_BPS 1_000_000, MAX_PRICE_MOVE_BPS 500, SERVICE_RESET 1 day,
///         SEALED_REFUND_AFTER 3 days). Also holds setMachine's validation, the open-time live check of a table and
///         the machine on/off clocks behind refundSealed.
library ArclawRules {
    function store(
        Arclaw.Outcome[][] storage tables,
        mapping(uint256 => mapping(address => uint256)) storage refPrice,
        mapping(uint256 => address[]) storage tokens,
        mapping(address => uint256) storage last,
        Arclaw.Machine memory mc,
        IPriceSource ps,
        Arclaw.OutcomeInput[] calldata input
    ) external returns (uint256 rtpBps, uint256 w) {
        if (input.length == 0) revert Arclaw.NoPrizes();
        if (input.length > 64) revert Arclaw.TooManyOutcomes();
        uint256 tableId = tables.length;
        Arclaw.Outcome[] storage t = tables.push();
        uint256[] memory vs = new uint256[](input.length);
        uint256 ev;
        for (uint256 i; i < input.length; ++i) {
            Arclaw.OutcomeInput calldata p = input[i];
            if (p.weight == 0) revert Arclaw.BadPrize(i);
            Arclaw.Outcome storage o = t.push();
            uint256 v;
            for (uint256 c; c < 3; ++c) {
                address tok = p.tokens[c];
                // Arc's USDC ERC-20 view is native USDC, never a card
                if (tok == address(0) || tok == 0x3600000000000000000000000000000000000000 || p.amounts[c] == 0) {
                    revert Arclaw.BadPrize(i);
                }
                uint256 px = ps.priceOf(tok);
                if (px == 0) revert Arclaw.BadPrize(i); // a zero reference price would break the live check
                uint256 cv = p.amounts[c] * px * 1e12 / 10 ** IERC20Metadata(tok).decimals();
                o.cards[c] = Arclaw.Card(tok, SafeCast.toUint96(cv), p.amounts[c]);
                v += cv;
                if (refPrice[tableId][tok] == 0) {
                    (refPrice[tableId][tok], last[tok]) = (px, px);
                    tokens[tableId].push(tok);
                }
            }
            if (v * 10_000 < uint256(mc.floorBps) * mc.price) revert Arclaw.BelowFloor(i, v * 10_000 / mc.price);
            if (v * 10_000 > uint256(mc.capBps) * mc.price) revert Arclaw.AboveCap(i, v * 10_000 / mc.price);
            (o.weight, o.tier, o.value) = (p.weight, p.tier, SafeCast.toUint128(v));
            vs[i] = v;
            w += p.weight;
            ev += v * p.weight;
        }
        // Bounds the products below (each < 2^21 * price * W^2 with cap <= 100x) inside uint256: a named error
        // instead of a 0x11 panic. W^2 cannot overflow itself (64 weights of uint88).
        if (w * w > (1 << 234) / mc.price) revert Arclaw.WeightTooHigh(w);
        rtpBps = ev * 10_000 / w / mc.price;
        if (ev * 10_000 < uint256(mc.rtpMinBps) * mc.price * w) revert Arclaw.RtpOutOfBand(rtpBps);
        // Max-boost EV = (1 - q) EV + q E[max of two draws], q = MAX_BOOST_BPS / 10000. Scaled by 10000 W^2:
        // (10000 - MAX_BOOST_BPS) * ev * W + MAX_BOOST_BPS * sum_ij w_i w_j max(v_i, v_j)  <=  rtpMax * price * W^2
        uint256 pairs;
        for (uint256 i; i < vs.length; ++i) {
            uint256 wi = input[i].weight;
            for (uint256 j; j < vs.length; ++j) {
                pairs += wi * input[j].weight * (vs[i] > vs[j] ? vs[i] : vs[j]);
            }
        }
        uint256 lucky = (10_000 - 100) * ev * w + 100 * pairs;
        if (lucky > uint256(mc.rtpMaxBps) * mc.price * w * w) revert Arclaw.RtpOutOfBand(lucky / w / w / mc.price);
    }

    /// Arclaw._setPrizes: the per-table arrays of a new table.
    function record(
        uint256[] storage weights,
        uint256[] storage machineOf,
        uint256[] storage priceOf,
        uint256[] storage pricedAt,
        uint256 w,
        uint256 machineId,
        uint256 price
    ) external {
        weights.push(w);
        machineOf.push(machineId);
        priceOf.push(price);
        pricedAt.push(block.timestamp);
    }

    /// Arclaw.setMachine: bounds and the only-up rules (see its NatSpec).
    function setMachine(
        mapping(uint256 => Arclaw.Machine) storage machines,
        uint256[] storage ids,
        uint256 machineId,
        Arclaw.Machine memory n
    ) external {
        if (machineId == 0 || machineId > type(uint16).max || n.price == 0) {
            revert Arclaw.BadMachine();
        }
        if (
            n.floorBps < 5000 || n.floorBps > n.rtpMinBps || n.rtpMinBps > n.rtpMaxBps
                // rtpMax * (1 + MAX_PRICE_MOVE_BPS 500) <= MAX_RTP_BPS 9500
                || uint256(n.rtpMaxBps) * 10_500 > 9500 * 10_000 || n.rtpMaxBps > n.capBps || n.capBps > 1_000_000
        ) revert Arclaw.BadMachine();
        Arclaw.Machine storage m = machines[machineId];
        if (m.price == 0) ids.push(machineId);
        else if (m.price != n.price) revert Arclaw.PriceImmutable(); // a new price is a new machine id
        else if (n.floorBps < m.floorBps || n.rtpMinBps < m.rtpMinBps) revert Arclaw.RuleLowered(); // re-rates sold boxes
        machines[machineId] = n;
        emit Arclaw.MachineSet(machineId, n.price, n.floorBps, n.capBps, n.rtpMinBps, n.rtpMaxBps);
    }

    /// Arclaw.setMachineActive: switching an off machine off again keeps its clock, and so does on+off before a day
    /// of service (SERVICE_RESET): the owner cannot push refundSealed back.
    function setActive(
        mapping(uint256 => uint256) storage offSince,
        mapping(uint256 => uint256) storage offClock,
        mapping(uint256 => uint256) storage onSince,
        uint256 id,
        bool active
    ) external {
        if (active) {
            delete offSince[id];
            onSince[id] = block.timestamp;
        } else if (offSince[id] == 0) {
            offSince[id] = block.timestamp;
            if (offClock[id] == 0 || block.timestamp >= onSince[id] + 1 days) offClock[id] = block.timestamp;
        }
        emit Arclaw.MachineActive(id, active);
    }

    /// Arclaw.sealedRefundAt: SEALED_REFUND_AFTER (3 days) after the earliest of `since` (the table went stale), the
    /// off clock and the pause clock; the off and pause clocks count until the machine / contract has been back in
    /// service SERVICE_RESET (1 day).
    function refundAt(
        mapping(uint256 => uint256) storage offSince,
        mapping(uint256 => uint256) storage offClock,
        mapping(uint256 => uint256) storage onSince,
        uint256 id,
        uint256 since,
        uint256 pausedSince,
        uint256 resumedAt,
        bool paused
    ) external view returns (uint256) {
        uint256 c = offClock[id];
        if (c != 0 && c < since && (offSince[id] != 0 || block.timestamp < onSince[id] + 1 days)) since = c;
        if (pausedSince != 0 && pausedSince < since && (paused || block.timestamp < resumedAt + 1 days)) {
            since = pausedSince;
        }
        return since + 3 days;
    }

    /// Live check of a table at open and retry: every card token within `maxMove` bps of the price the table was set
    /// at (else TableStale; an unpriced token reverts in the source), and every pack still worth `floorBps` of
    /// `price` at those live prices (else BelowFloor, live bps). Records each live price in `last`.
    function check(
        Arclaw.Outcome[] storage t,
        mapping(address => uint256) storage ref,
        address[] storage toks,
        mapping(address => uint256) storage last,
        IPriceSource ps,
        uint256 maxMove,
        uint256 floorBps,
        uint256 price
    ) external {
        for (uint256 i; i < toks.length; ++i) {
            address tok = toks[i];
            uint256 r = ref[tok];
            uint256 p = ps.priceOf(tok);
            last[tok] = p;
            uint256 d = p > r ? p - r : r - p;
            if (d * 10_000 > r * maxMove) revert Arclaw.TableStale();
        }
        uint256 floorV = floorBps * price; // scaled by 10000
        for (uint256 i; i < t.length; ++i) {
            // with every card within maxMove, a pack this far above the floor cannot be under it (3 wei of rounding)
            if (uint256(t[i].value) * (10_000 - maxMove) >= floorV + 30_000) continue;
            uint256 live;
            for (uint256 c; c < 3; ++c) {
                Arclaw.Card storage cd = t[i].cards[c];
                address tok = cd.token;
                live += uint256(cd.value) * last[tok] / ref[tok];
            }
            if (live * 10_000 < floorV) revert Arclaw.BelowFloor(i, live * 10_000 / price);
        }
    }
}

/// @title ArclawPayout: the reveal's draw and card payouts, an external library linked into Arclaw (24 KB code limit)
/// @notice Runs in Arclaw's context (delegatecall): its balance, its tokens, its events. Draws one outcome per box from
///         the opening's word (plus the luck stream), pays each card from inventory, buys a short card just in time on
///         the allow-listed desk within the per-reveal, per-card and daily caps, and otherwise refunds it at its
///         refund value. Never reverts on a card token, the desk or the price source.
library ArclawPayout {
    using SafeERC20 for IERC20;

    /// Everything about the opening the payout needs. `reserved` is every reserve and IOU of Arclaw (credit,
    /// pending, sealed, owed, top-ups); JIT buys only spend native above it and above this reveal's refunds.
    struct Ctx {
        uint256 openingId;
        address opener;
        uint256 machineId;
        uint256 boxes;
        bytes32 word;
        uint256 boost;
        uint256 weight;
        uint256 reserved;
        IPriceSource ps;
        bool cash; // rescue: every card at its refund value, no token touched
    }

    /// Returns the cards paid in stock and the USDC refund owed for the others.
    function pay(
        Arclaw.Outcome[] storage t,
        Arclaw.Jit storage jit,
        Arclaw.Limits storage lim,
        mapping(address => bool) storage sinks,
        mapping(address => uint256) storage ref,
        mapping(address => uint256) storage last,
        mapping(address => uint256) storage paidOut,
        Ctx memory c
    ) external returns (uint256 paid, uint256 refund) {
        uint256 buys;
        for (uint256 b; b < c.boxes; ++b) {
            uint256 idx = _draw(t, c.weight, uint256(keccak256(abi.encode(c.word, b))));
            // Luck: with probability boost/10000 draw a second pack from an independent stream, keep the better one.
            bool boosted;
            if (c.boost != 0 && uint256(keccak256(abi.encode(c.word, b, "luck"))) % 10_000 < c.boost) {
                uint256 alt = _draw(t, c.weight, uint256(keccak256(abi.encode(c.word, b, "luck", 1))));
                boosted = true;
                if (t[alt].value > t[idx].value) idx = alt;
            }
            Arclaw.Outcome storage out = t[idx];
            uint256 tier = out.tier;
            emit Arclaw.OutcomeDrawn(c.openingId, c.opener, c.machineId, b, tier, idx, out.value, boosted);
            for (uint256 k; k < 3; ++k) {
                Arclaw.Card memory card = out.cards[k];
                bool ok;
                if (!c.cash) {
                    uint256 have = _balanceOf(card.token);
                    if (have < card.amount && buys < jit.maxBuys) {
                        (bool tried, bool bought) = _jitBuy(jit, lim, sinks, c, card.token, card.amount - have, refund);
                        if (tried) ++buys;
                        if (bought) have = _balanceOf(card.token);
                    }
                    ok = have >= card.amount && IERC20(card.token).trySafeTransfer(c.opener, card.amount);
                }
                emit Arclaw.CardDrawn(c.openingId, c.opener, card.token, c.machineId, b, k, card.amount, tier, ok);
                if (ok) {
                    ++paid;
                    paidOut[card.token] += card.amount;
                } else {
                    uint256 r = _refundValue(ref, last, c.ps, card.token, card.value);
                    refund += r;
                    emit Arclaw.Refunded(c.openingId, c.opener, b, k, r);
                }
            }
        }
    }

    /// Buys `shares` of `token` on the JIT desk with native above every reserve, IOU and the refunds already
    /// accumulated in this reveal (reserveFloor may be used), within the daily lim.jitCap. `tried`: a buy was sent
    /// (counts against jit.maxBuys). `ok`: the shares arrived. The daily cap counts every buy the desk accepted, so a
    /// desk that takes the native and delivers short or nothing costs at most jitCap a day.
    function _jitBuy(
        Arclaw.Jit storage jit,
        Arclaw.Limits storage lim,
        mapping(address => bool) storage sinks,
        Ctx memory c,
        address token,
        uint256 shares,
        uint256 refundSoFar
    ) private returns (bool tried, bool ok) {
        Arclaw.Jit memory j = jit;
        if (j.desk == address(0) || !sinks[j.desk]) return (false, false);
        uint256 cost;
        try Arclaw(payable(address(this))).valueOf(token, shares) returns (uint256 v) {
            cost = v * (10_000 + j.slippageBps) / 10_000 + 1;
        } catch {
            return (false, false);
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 day = uint32(block.timestamp / 1 days);
        if (lim.day != day) (lim.day, lim.misses, lim.jitSpent) = (day, 0, 0);
        uint256 bal = address(this).balance;
        uint256 free = bal > c.reserved ? bal - c.reserved : 0;
        if (cost > j.maxPerCard || free < cost + refundSoFar || lim.jitSpent + cost > lim.jitCap) return (false, false);
        uint256 before = _balanceOf(token);
        try IAstockDesk(j.desk).buy{value: cost}(token, shares, address(this)) {}
        catch {
            return (true, false);
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        lim.jitSpent += uint96(cost); // <= jitCap - jitSpent, checked above
        uint256 got = _balanceOf(token);
        got = got > before ? got - before : 0;
        emit Arclaw.JitBought(c.openingId, token, cost, got);
        return (true, got >= shares);
    }

    /// A short card refunds the lower of its value when the table was set and its value at the latest price Arclaw
    /// read (now, or the last good read if the source fails), so a fall in the stock cannot be cashed out at the old
    /// price, even behind a stale feed. A reveal is never blocked by the oracle.
    function _refundValue(
        mapping(address => uint256) storage ref,
        mapping(address => uint256) storage last,
        IPriceSource ps,
        address token,
        uint256 value
    ) private returns (uint256) {
        uint256 r = ref[token];
        uint256 p = last[token];
        if (address(ps) != address(0)) {
            try ps.priceOf(token) returns (uint256 live) {
                if (live != 0) (p, last[token]) = (live, live);
            } catch {}
        }
        return p >= r ? value : value * p / r;
    }

    function _draw(Arclaw.Outcome[] storage t, uint256 w, uint256 rand) private view returns (uint256) {
        uint256 r = rand % w;
        uint256 n = t.length;
        for (uint256 i; i < n; ++i) {
            uint256 wi = t[i].weight;
            if (r < wi) return i;
            r -= wi;
        }
        revert Arclaw.NoPrizes(); // unreachable: weights sum to w
    }

    /// Inventory of `token`; 0 if the call fails or returns short data, so the card goes to the refund path.
    function _balanceOf(address token) private view returns (uint256 v) {
        bytes memory data = abi.encodeCall(IERC20.balanceOf, (address(this)));
        bool ok;
        uint256 size;
        assembly ("memory-safe") {
            ok := staticcall(gas(), token, add(data, 0x20), mload(data), 0x00, 0x20)
            size := returndatasize()
            v := mload(0x00)
        }
        if (!ok || size < 32) v = 0;
    }
}
