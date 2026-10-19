// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw, ArclawRules, ArclawPayout} from "../../src/Arclaw.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";

/// Independent audit 8a (round 5, commit 32e6f07).
///
/// Naming (round 6): test_fixed_* assert the fix (they were test_exploit_*). test_documented_* characterize findings
/// accepted and documented in docs/SECURITY.md. test_sound_* check properties that held up.
contract A8aFindings is Base {
    uint256 constant T0 = 1_800_000_000; // Base.setUp warp, 08:00 UTC; absolute warps (via_ir)
    uint256 constant DAY0 = T0 / 1 days;

    receive() external payable {}

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1)); // table 0, priced at T0
        vm.deal(address(box), 20 ether); // float for VRF subsidies
        box.setJit(address(0), 0, 0, 0, FLOAT);
    }

    function _misses() internal view returns (uint256 m) {
        uint32 day;
        (day, m,,,) = box.limits();
        if (day != block.timestamp / 1 days) m = 0;
    }

    function _reprice() internal {
        Arclaw.OutcomeInput[] memory t = _table(address(nvda), P1); // before the prank (it makes calls)
        vm.prank(op);
        box.operatorSetPrizes(M1, t);
    }

    // ================================================================== M-01

    /// M-01: a breaker trip WHILE PAUSED restarted the pause clock (_miss called _clock() unconditionally; while
    /// paused, once the last unpause was more than SERVICE_RESET old, _clock set pausedSince = now).
    /// Fixed in round 6: _clock is a no-op while paused, the running pause owns the clock.
    /// Here: VRF goes quiet, the guardian/owner pauses at P (players were promised refundSealed at P + 3 days).
    /// Bob, holding 10 expired one-box openings made before the pause, returns them at P + 2.5 days: the breaker
    /// trips, the clock stays at P and alice leaves at P + 3 days.
    function test_fixed_M01_tripWhilePausedKeepsRefundClock() public {
        _play(alice, M1, 3); // alice just wants out
        _play(bob, M1, 10);
        uint256[] memory ids = new uint256[](10);
        for (uint256 i; i < 10; ++i) {
            (ids[i],) = _open(bob, M1, 1); // VRF accepts, never answers
        }
        vm.warp(T0 + 120);
        box.pause(); // incident step 1: pause first
        uint256 p = T0 + 120;
        assertEq(box.pausedSince(), p);
        assertEq(box.sealedRefundAt(M1), p + 3 days, "promise: refunds 3 days after the pause");

        // operator keeps the table fresh while paused (or the owner does it)
        vm.warp(T0 + 2 days + 12 hours);
        _reprice();
        // bob returns his 10 expired openings (their pinned table 0 aged out long ago): maxMisses (10) -> trip
        for (uint256 i; i < 10; ++i) {
            vm.prank(bob);
            box.returnBoxes(ids[i]);
        }
        assertTrue(box.paused());
        assertEq(_misses(), 10, "the breaker tripped");
        assertEq(box.pausedSince(), p, "FIXED: the trip does not restart the running pause clock");
        assertEq(box.sealedRefundAt(M1), p + 3 days);

        vm.warp(p + 3 days);
        uint256 a0 = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 3); // the promised exit holds
        assertEq(alice.balance - a0, 3 * P1);
    }

    /// M-01, owner variant: with maxMisses lowered to 1, a return (any player's) every other day during a pause no
    /// longer moves the clock; alice leaves 3 days after the pause.
    function test_fixed_M01_ownerCannotKeepPausedBoxesLocked() public {
        _play(alice, M1, 1);
        _play(bob, M1, 5);
        uint256[] memory ids = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            (ids[i],) = _open(bob, M1, 1);
        }
        vm.warp(T0 + 120);
        box.pause();
        box.setLimits(2000 ether, 1);
        // day 2: one expired opening returned (a trip) while the operator reprices; refundSealed not due yet
        vm.warp((DAY0 + 2) * 1 days + 1 hours);
        _reprice();
        vm.prank(bob);
        box.returnBoxes(ids[0]);
        assertEq(box.pausedSince(), T0 + 120, "clock kept");
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M1, 1);
        // day 4: another trip, the clock is still the pause's; alice is out
        vm.warp((DAY0 + 4) * 1 days + 1 hours);
        _reprice();
        vm.prank(bob);
        box.returnBoxes(ids[1]);
        assertEq(box.pausedSince(), T0 + 120, "clock kept");
        assertEq(box.sealedRefundAt(M1), T0 + 120 + 3 days);
        vm.prank(alice);
        box.refundSealed(M1, 1);
        assertTrue(box.paused());
    }

    // ================================================================== L-01

    /// L-01: one miss per opening makes return + reopen after a retry free, so the breaker allows about
    /// 2 x (maxMisses - 1) fresh draws a day instead of the documented "about maxMisses re-rolls a day".
    /// maxMisses 3. Day 0: two openings, both withheld, the keeper retries both (2 misses), withheld again.
    /// Day 1: both are returned (0 misses) and reopened (2 new draws), withheld, retried (2 misses, 2 more draws).
    /// 4 fresh draws on day 1 for 2 booked misses, and `open` is still not closed.
    /// Not changed (round 6), kept as a characterization test: the bound is documented as about 2 x (maxMisses - 1)
    /// re-rolls a day (Arclaw NatSpec, docs/SECURITY.md). Booking the return as well would double count again.
    function test_documented_L01_returnAfterRetryIsAFreeReroll() public {
        box.setLimits(2000 ether, 3);
        _play(bob, M1, 2);
        (uint256 a,) = _open(bob, M1, 1);
        (uint256 b,) = _open(bob, M1, 1);
        vm.warp(T0 + 61);
        box.retry(a); // keeper
        box.retry(b);
        assertEq(_misses(), 2);

        vm.warp(T0 + 1 days + 1 hours); // next UTC day, retries expired too; table 0 aged out
        _reprice();
        uint256 draws;
        vm.startPrank(bob);
        box.returnBoxes(a);
        box.returnBoxes(b);
        vm.stopPrank();
        assertEq(_misses(), 0, "returns book nothing");
        (uint256 c,) = _open(bob, M1, 1);
        (uint256 d,) = _open(bob, M1, 1);
        draws += 2;
        vm.warp(block.timestamp + 61);
        box.retry(c);
        box.retry(d);
        draws += 2;
        assertEq(_misses(), 2);
        assertEq(draws, 4, "4 fresh draws today");
        assertGt(draws, 3, "more than maxMisses re-rolls in a day");
        // and the breaker is still open: bob could keep going
        _play(bob, M1, 1);
        _open(bob, M1, 1);
    }

    // ================================================================== L-02

    /// L-02: a VRF that accepts requests but never answers, with traffic under maxMisses openings a day, never trips
    /// the breaker, never pauses (pauseIfVrfDown reverts VrfAlive) and, while the operator reprices, never opens
    /// refundSealed. A small holder can only cycle open / retry / return forever; their exit depends entirely on
    /// the guardian. (Pre-existing; round 5 halved the misses per stuck opening, 2 -> 1, so it trips later.)
    /// Not changed (round 6), kept as a characterization test: documented in docs/SECURITY.md, the guardian is
    /// load-bearing for a VRF that accepts requests but never answers under low traffic.
    function test_documented_L02_quietVrfLowTrafficNoExit() public {
        _play(alice, M1, 1);
        for (uint256 d; d < 6; ++d) {
            uint256 t = (DAY0 + 1 + d) * 1 days + 1 hours;
            vm.warp(t);
            _reprice();
            vm.warp(t + 1); // yesterday's table (priced at t - 1 day) has aged out
            if (d > 0) {
                vm.prank(alice);
                box.returnBoxes(d - 1); // yesterday's opening, retried and expired
            }
            (uint256 id,) = _open(alice, M1, 1);
            assertEq(id, d);
            vm.warp(t + 62);
            box.retry(id); // keeper: 1 miss
            vm.warp(t + 123);
            vm.expectRevert(Arclaw.VrfAlive.selector);
            box.pauseIfVrfDown();
        }
        assertFalse(box.paused());
        assertEq(box.pausedSince(), 0, "no clock ever started");
        assertGt(box.sealedRefundAt(M1), block.timestamp + 3 days);
    }

    // ================================================================== I-01

    /// I-01: Limits.misses was uint16 and kept counting after the trip; at 65535 misses in a day every retry and
    /// every un-retried return panicked until 00:00 UTC. Fixed in round 6: the counter saturates at maxMisses, so
    /// even a count at the uint16 ceiling (unreachable now, forced here) never blocks a return.
    function test_fixed_I01_missCounterSaturates() public {
        _play(bob, M1, 1);
        (uint256 id,) = _open(bob, M1, 1);
        vm.warp(T0 + 1 days + 1 hours);
        uint256 today = block.timestamp / 1 days;
        // limits slot 44: day (32) | misses (16) | maxMisses (16) | jitCap (96) | jitSpent (96)
        uint256 word = uint256(vm.load(address(box), bytes32(uint256(44))));
        word = (word & ~uint256(0xffffffffffff)) | today | (uint256(type(uint16).max) << 32);
        vm.store(address(box), bytes32(uint256(44)), bytes32(word));
        vm.prank(bob);
        box.returnBoxes(id);
        assertEq(_misses(), type(uint16).max, "no increment past the cap");
        assertEq(box.balanceOf(bob, M1), 1);
    }

    // ================================================================== I-02

    /// I-02: the owner closes `open` for the rest of the day without starting any refund clock by lowering
    /// maxMisses under today's count (setLimits); only a trip inside _miss runs _clock. Owner trust, one day max.
    /// Not changed (round 6), kept as a characterization test: documented owner trust (docs/SECURITY.md).
    function test_documented_I02_setLimitsClosesOpenWithoutClock() public {
        _play(bob, M1, 2);
        (uint256 id,) = _open(bob, M1, 1);
        vm.warp(T0 + 61);
        box.retry(id); // 1 miss, under the default 10
        box.setLimits(2000 ether, 1);
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(bob);
        vm.expectRevert(Arclaw.VrfMisses.selector);
        box.open(M1, 1, tid);
        assertEq(box.pausedSince(), 0, "no clock");
        assertEq(box.resumedAt(), 0, "no hold");
    }

    // ================================================================== sound

    /// The breaker closes only `open`, until 00:00 UTC; play, reveal, retry and return go on.
    function test_sound_breakerScopeAndReopen() public {
        box.setLimits(2000 ether, 1);
        _play(bob, M1, 3);
        (uint256 a,) = _open(bob, M1, 1);
        (uint256 b, uint256 rb) = _open(bob, M1, 1);
        vrf.fulfill(rb, keccak256("w"));
        vm.warp(T0 + 61);
        box.retry(a); // trip
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(bob);
        vm.expectRevert(Arclaw.VrfMisses.selector);
        box.open(M1, 1, tid);
        _play(alice, M1, 1); // plays go on
        box.reveal(b); // reveals go on
        vm.warp((DAY0 + 1) * 1 days);
        _reprice();
        _open(bob, M1, 1); // reopens at 00:00 UTC
    }

    /// The libraries refuse direct calls: their state-changing entry points only run by delegatecall.
    function test_sound_librariesRejectDirectCalls() public {
        address payout = deployCode("Arclaw.sol:ArclawPayout");
        address rules = deployCode("Arclaw.sol:ArclawRules");
        vm.deal(payout, 1 ether);
        nvda.mint(payout, 1 ether); // without the guard the sweep below would succeed
        (bool ok,) =
            payout.call(abi.encodeWithSelector(ArclawPayout.sweep.selector, address(nvda), alice, 1 ether, 0));
        assertFalse(ok, "sweep");
        assertEq(nvda.balanceOf(alice), 0);
        (ok,) = payout.call(abi.encodeWithSelector(ArclawPayout.buy.selector, address(desk), address(nvda), 1, 1));
        assertFalse(ok, "buy");
        (ok,) = rules.call(abi.encodeWithSelector(ArclawRules.setActive.selector, 0, 1, 2, 3, 1, false));
        assertFalse(ok, "setActive");
        // control: the delegatecall path through Arclaw works
        box.sweep(address(nvda), alice, 1);
        assertEq(nvda.balanceOf(alice), 1);
    }

    /// A swap's hold keeps the original pause clock through a later re-pause (no restart), and the clock counts
    /// past the swap: pause, swap, swap back, unpause, pause again 3 days later -> refunds still from the first pause.
    function test_sound_swapHoldKeepsClock() public {
        _play(alice, M1, 1);
        box.pause();
        uint256 p = T0; // via_ir re-reads block.timestamp: use the constant
        box.setPolicy(IPriceSource(address(1)), 50 ether);
        box.setPolicy(IPriceSource(address(prices)), 50 ether);
        box.unpause();
        vm.warp(T0 + 12 hours);
        _reprice();
        vm.warp(T0 + 1 days);
        _reprice();
        vm.warp(T0 + 2 days);
        _reprice();
        vm.warp(T0 + 3 days);
        box.pause();
        assertEq(box.pausedSince(), p, "re-pause keeps the first clock");
        vm.prank(alice);
        box.refundSealed(M1, 1);
    }

    /// No float: a keeper retry that sends more than the fee never gets a subsidy carved out of reserves, and the
    /// change comes back; every reserve stays backed.
    function test_sound_subsidyNeverFromReserves() public {
        box.setJit(address(0), 0, 0, 0, 0);
        vm.deal(address(box), 0);
        _play(alice, M1, 2);
        uint256 fee = vrf.fee();
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.VrfFeeTopUp.selector, fee, 0));
        box.open(M1, 1, tid);
        vm.prank(alice);
        (uint256 id,) = box.open{value: fee}(M1, 1, tid);
        vm.warp(T0 + 61);
        uint256 k0 = address(this).balance;
        box.retry{value: fee * 3}(id);
        assertEq(k0 - address(this).balance, fee, "keeper paid exactly the fee, change returned");
        uint256 res = box.pendingReserve() + box.sealedReserve() + box.topUpReserve() + box.reservedCredit()
            + box.totalOwed();
        assertGe(address(box).balance, res, "reserves backed");
    }
}
