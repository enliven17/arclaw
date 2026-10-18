// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {LuckVault, ILuck} from "../../src/LuckVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Vm.sol";

/// Stand-in for Arc's USDC ERC-20 view at 0x3600..00: 6 dp, backed by the account's native (18 dp) balance, so a
/// transfer moves native USDC. Uses the cheatcode address only to emulate the precompile.
contract ArcUsdcAlias {
    Vm constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function balanceOf(address a) external view returns (uint256) {
        return a.balance / 1e12;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 wei_ = amount * 1e12;
        VM.deal(msg.sender, msg.sender.balance - wei_);
        VM.deal(to, to.balance + wei_);
        return true;
    }
}

/// A token whose calls succeed with no return data (a proxy upgraded/pointed at the wrong implementation).
contract SilentToken {
    fallback() external {}
}

contract A3bArclawToken is ERC20 {
    constructor() ERC20("ARCLAW", "ARCLAW") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

/// A contract that holds one aged stake and opens anybody's boxes with it, forwarding the cards.
contract BoostRenter {
    Arclaw immutable box;

    constructor(Arclaw b) {
        box = b;
    }

    function stake(LuckVault v, IERC20 t, uint256 a) external {
        t.approve(address(v), a);
        v.stake(a);
    }

    function openFor(uint256 machineId, uint256 n) external returns (uint256 id) {
        (id,) = box.open(machineId, n, box.currentTable(machineId) - 1);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    receive() external payable {}
}

/// Auditor 3b. M-01, M-02, L-01 and L-02 flipped to the FIXED behaviour; the boost-renting INFO is accepted.
contract A3bFindingsTest is Base {
    address constant USDC_ERC20 = 0x3600000000000000000000000000000000000000;

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1)); // 0.5x (w3) / 1.5x (w1): EV 0.75x at $200
    }

    function _setNvda(uint256 px) internal {
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        (t[0], p[0]) = (address(nvda), px);
        prices.setPrices(t, p);
    }

    /// EV of the current M1 table at live prices, bps of the price.
    function _liveRtpBps() internal view returns (uint256) {
        Arclaw.Outcome[] memory o = box.outcomes(M1);
        uint256 ev;
        uint256 w;
        for (uint256 i; i < o.length; ++i) {
            uint256 v;
            for (uint256 c; c < 3; ++c) {
                v += box.valueOf(o[i].cards[c].token, o[i].cards[c].amount);
            }
            ev += v * o[i].weight;
            w += o[i].weight;
        }
        return ev * 10_000 / w / P1;
    }

    // ------------------------------------------------------------------ M-01 (3b)

    /// M-01 fixed: sweep refuses Arc's USDC view outright, and any other token whose transfer drains native may
    /// not take more than the free balance. The USDC view is also refused as a card.
    function test_fixed_m01_sweepCannotMoveReservedNative() public {
        vm.etch(USDC_ERC20, address(new ArcUsdcAlias()).code);
        vm.deal(address(box), 0);
        _play(alice, M1, 4);
        _open(alice, M1, 4);
        vm.deal(address(box), 4 ether); // exactly backed, no float
        assertEq(box.pendingReserve(), 4 ether);
        assertEq(box.freeBalance(), 0);

        vm.expectRevert(Arclaw.UsdcAlias.selector);
        box.sweep(USDC_ERC20, address(0xBEEF), 4e6);

        address other = makeAddr("native-backed-token"); // same behaviour at another address
        vm.etch(other, address(new ArcUsdcAlias()).code);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.sweep(other, address(0xBEEF), 1);
        vm.deal(address(box), 5 ether); // 1 free
        box.sweep(other, address(0xBEEF), 1e6); // within the free balance
        assertEq(address(box).balance, 4 ether, "pending still backed");

        Arclaw.OutcomeInput[] memory t = _table(address(nvda), P1);
        t[0].tokens[1] = USDC_ERC20;
        vm.expectRevert(abi.encodeWithSelector(Arclaw.BadPrize.selector, 0));
        box.setPrizes(M1, t);
    }

    // ------------------------------------------------------------------ M-02 (3b)

    /// M-02 fixed: each table records every card token's price; open() reverts TableStale once a live price moved
    /// more than maxPriceMoveBps (default 5%) either way, and maxTableAge is capped at one day.
    function test_fixed_m02_movedPricesCloseTheTable() public {
        _play(alice, M1, 20);
        vm.warp(block.timestamp + 20 hours); // table still inside its age
        _setNvda(280e6); // +40% since the table was priced
        assertGt(_liveRtpBps(), 10_000, "live EV above the price");
        uint256 shown = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(Arclaw.TableStale.selector);
        box.open(M1, 20, shown);

        _setNvda(100e6); // -50%: the floor would no longer hold
        vm.prank(alice);
        vm.expectRevert(Arclaw.TableStale.selector);
        box.open(M1, 1, shown);

        _setNvda(210e6); // +5% is still inside the band
        (uint256 id,) = _open(alice, M1, 1);
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Pending));
        assertEq(box.lastPrice(address(nvda)), 210e6, "open records the price it checked");

        vm.expectRevert(Arclaw.BadMachine.selector); // window capped at 1 day
        box.setMaxTableAge(365 days);
        box.setMaxTableAge(1 days);
        box.setGuards(100, 0); // tighter band: +5% is now too far
        vm.prank(alice);
        vm.expectRevert(Arclaw.TableStale.selector);
        box.open(M1, 1, shown);
    }

    // ------------------------------------------------------------------ L-01 (3b)

    /// L-01 fixed: inventory is read with a raw staticcall and a 32-byte return check, so a card token that answers
    /// with empty data reads as 0 and the card goes to the refund path; the opening reveals and the reserve frees.
    function test_fixed_l01_silentCardTokenIsRefundedNotStuck() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        vm.etch(address(nvda), address(new SilentToken()).code); // token proxy now returns nothing

        uint256 before = alice.balance;
        vm.prank(alice);
        box.reveal(id);
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Revealed));
        assertEq(box.cardsRefunded(), 3);
        assertGe(alice.balance - before, P1 / 2 - 10, "the pack value in USDC (0.5x or 1.5x)");
        assertEq(box.pendingReserve(), 0, "reserve released");
    }

    /// L-01 escape: a fulfilled opening still unrevealed RESCUE_AFTER (7 days) its request can be settled by the
    /// opener (or a keeper) with every card paid in USDC at its refund value, without touching any card token.
    function test_fixed_l01_rescueSettlesInCashAfterSevenDays() public {
        _play(alice, M1, 2);
        (uint256 id, uint256 req) = _open(alice, M1, 2);
        vrf.fulfill(req, keccak256("w"));
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.rescue(id);

        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        vm.expectRevert(Arclaw.NotOpener.selector);
        box.rescue(id);

        uint256 stockBefore = nvda.balanceOf(address(box));
        uint256 before = alice.balance;
        vm.prank(alice);
        box.rescue(id);
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Revealed));
        assertEq(nvda.balanceOf(address(box)), stockBefore, "no card token touched");
        assertEq(box.cardsPaid(), 0);
        assertEq(box.cardsRefunded(), 6);
        assertGe(alice.balance - before, P1 - 20, "two packs in USDC, at least 0.5x each");
        assertEq(box.pendingReserve(), 0);

        vm.prank(alice);
        vm.expectRevert(Arclaw.NotPending.selector);
        box.rescue(id);
    }

    // ------------------------------------------------------------------ L-02 (3b)

    /// L-02 fixed: every successful price read is kept as the token's last good price, and a short card refunds
    /// min(table value, value at the latest price read). After a crash the contract saw, a stale feed no longer
    /// brings back the pre-crash value: 0.375, not 0.75.
    function test_fixed_l02_staleOracleRefundsAtLastGoodPrice() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.sweep(address(nvda), address(1), 100 ether); // short: every card is refunded (JIT off)
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        _play(bob, M1, 1);
        (uint256 bobId, uint256 bobReq) = _open(bob, M1, 1);
        vrf.fulfill(bobReq, keccak256("b"));

        _setNvda(100e6); // -50%: a fair refund is now 0.375
        box.reveal(bobId); // a reveal reads the crashed price
        assertEq(box.lastPrice(address(nvda)), 100e6);
        _setNvda(0); // feed goes stale / unpriced: priceOf reverts
        uint256 before = alice.balance;
        box.reveal(id);
        assertApproxEqAbs(alice.balance - before, 0.375 ether, 10, "refund at the last good price");
    }

    // ------------------------------------------------------------------ INFO (3b)

    /// INFO (accepted, see Arclaw._boostOf): the boost belongs to whoever calls open(), and boxes are freely
    /// transferable. One aged stake behind a contract can open everyone's boxes at the maximum boost (boost
    /// renting). RTP stays inside the band because the band is checked at MAX_BOOST_BPS, but "locked holders" stops
    /// being the population that gets the boost.
    function test_info_boostCanBeRentedThroughAnOpenerContract() public {
        LuckVault v = new LuckVault();
        A3bArclawToken t = new A3bArclawToken();
        v.setLuckToken(address(t));
        uint256[] memory mins = new uint256[](1);
        uint256[] memory bps = new uint256[](1);
        (mins[0], bps[0]) = (1000 ether, 100);
        v.setTiers(mins, bps);
        box.setLuck(ILuck(address(v)));

        BoostRenter renter = new BoostRenter(box);
        t.mint(address(renter), 1000 ether);
        renter.stake(v, IERC20(address(t)), 1000 ether);
        vm.warp(block.timestamp + 25 hours);
        box.setPrizes(M1, _table(address(nvda), P1)); // reprice after the warp

        _play(bob, M1, 1); // bob has no stake
        vm.prank(bob);
        box.safeTransferFrom(bob, address(renter), M1, 1, "");
        uint256 id = renter.openFor(M1, 1);
        assertEq(box.openingBoost(id), 100, "bob's box opened at max boost");
    }
}
