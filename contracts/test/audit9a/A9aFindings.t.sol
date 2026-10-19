// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";
import {MockPriceSource} from "../../src/mocks/MockPriceSource.sol";
import {HalfRefundVRF} from "./HalfRefundVRF.sol";

/// Independent audit 9a (round 6, commit eb8792d): the diff vs 32e6f07 and the pause / refund-clock state machine.
/// Absolute warps only (via_ir re-reads block.timestamp). T0 = 1_800_000_000 is 08:00 UTC.
contract A9aFindingsTest is Base {
    uint256 constant T0 = 1_800_000_000;
    uint256 constant DAY0 = T0 / 1 days;

    receive() external payable {}

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1)); // table 0, priced at T0
    }

    // ------------------------------------------------------------------ helpers

    function _wordFor(uint256 idx) internal pure returns (bytes32 w) {
        for (uint256 i = 1;; ++i) {
            w = bytes32(i);
            uint256 r = uint256(keccak256(abi.encode(w, uint256(0)))) % 4;
            if ((idx == 1) == (r >= 3)) return w;
        }
    }

    function _misses() internal view returns (uint256 m) {
        uint32 day;
        (day, m,,,) = box.limits();
        if (day != block.timestamp / 1 days) m = 0;
    }

    function _resEx() internal view returns (uint256) {
        return box.reservedCredit() + box.pendingReserve() + box.sealedReserve() + box.topUpReserve();
    }

    // ================================================================== INFO-01

    /// INFO-01: with minBuffer = 0 (Deploy never calls setGuards, so mainnet runs with 0) the only settle-time
    /// auto-pause left is a NEW IOU. An opener's VRF top-up is paid back by _payTopUp from the balance above the
    /// reserves WITHOUT totalOwed (top-ups rank ahead of IOUs, by design). When D20 refunds an expired request at
    /// less than 100% (refundBps >= 50%), the shortfall comes out of the money the owner sent to fund an IOU: the
    /// funded IOU becomes unfunded again, no new IOU is booked (fresh == false) and _unreserved() < minBuffer is
    /// 0 < 0, so nothing pauses. Before round 6 (totalOwed != 0) this settle paused. Amount: (1 - refundBps) x fee
    /// per expired top-up request (about 0.012 USDC on mainnet), and box revenue refills it, so this is not a loss,
    /// only a gap between "funded IOU does not re-pause" and "an IOU that becomes unbacked again does".
    function test_info_I01_topUpPaybackUnfundsFundedIouWithoutPause() public {
        vm.etch(address(vrf), address(new HalfRefundVRF()).code); // same storage, half refunds

        // an IOU, as in Round6._iouSetup: no float, no JIT, no inventory
        box.setJit(address(0), 0, 0, 0, 0);
        vm.deal(address(box), 0);
        box.sweep(address(nvda), address(this), nvda.balanceOf(address(box)));
        _play(alice, M1, 1);
        uint256 fee = vrf.fee();
        vm.prank(alice);
        (uint256 a, uint256 ra) = box.open{value: fee}(M1, 1, 0);
        HalfRefundVRF(payable(address(vrf))).fulfill(ra, _wordFor(1));
        vm.prank(alice);
        box.reveal(a);
        uint256 iou = box.owed(alice);
        assertGt(iou, 0);
        assertTrue(box.paused());

        // runbook: the owner funds the IOU exactly (nothing unreserved), restocks and unpauses; minBuffer stays 0
        uint256 need = _resEx() + box.totalOwed() - address(box).balance;
        (bool ok,) = address(box).call{value: need}("");
        assertTrue(ok);
        nvda.mint(address(box), 100 ether);
        box.unpause();
        assertEq(box.minBuffer(), 0);

        // bob plays and opens: no unreserved balance, so he pays the full fee as a top-up
        _play(bob, M1, 1);
        vm.prank(bob);
        (uint256 b,) = box.open{value: fee}(M1, 1, 0);
        assertEq(box.openingTopUp(b), fee);

        // his request expires; he retries (table still fresh) paying again; D20 refunds the old fee at 50%
        vm.warp(T0 + 100);
        vm.prank(bob);
        box.retry{value: fee}(b);

        // the 50% shortfall came out of the IOU's backing, no new IOU, no pause
        assertEq(box.owed(bob), 0, "no new IOU");
        assertFalse(box.paused(), "INFO: no pause although the old IOU is now under-backed");
        uint256 backing = address(box).balance - _resEx();
        // the live request's top-up (fee) is still reserved; the dead one's half fee is gone for good
        assertEq(backing, iou - fee / 2 - fee, "IOU backing short by the refund gap (plus the live top-up)");
        assertLt(backing, box.totalOwed());
    }

    // ================================================================== verified sound: _clock no-op while paused

    /// A long pause with breaker trips on several days (including a saturated re-trip): the
    /// pause clock never moves, refundSealed opens 3 days after the pause and stays open through a day of service.
    function test_sound_tripsWhilePausedNeverMoveClock() public {
        box.setLimits(2000 ether, 1);
        _play(alice, M1, 6);
        uint256[] memory ids = new uint256[](6);
        for (uint256 i; i < 6; ++i) {
            (ids[i],) = _open(alice, M1, 1);
        }
        _play(bob, M1, 1);
        vm.warp(T0 + 30);
        box.pause();
        uint256 p = box.pausedSince();
        assertEq(p, T0 + 30);

        vm.warp(T0 + 61);
        box.retry(ids[0]); // trip while paused
        box.retry(ids[1]); // saturated re-trip
        assertEq(box.pausedSince(), p);
        // day 2: more trips while paused
        vm.warp(T0 + 2 days);
        box.setPrizes(M1, _table(address(nvda), P1)); // keep a fresh table so only the pause clock counts
        vm.prank(alice);
        box.returnBoxes(ids[2]); // pinned table 0 aged out
        assertEq(box.pausedSince(), p);
        // day 4: still paused, refundable
        vm.warp(T0 + 4 days);
        box.setPrizes(M1, _table(address(nvda), P1));
        vm.prank(alice);
        box.returnBoxes(ids[3]);
        assertEq(box.pausedSince(), p);
        assertEq(box.sealedRefundAt(M1), p + 3 days);
        // unpause; the clock keeps counting for a day of service after max(unpause, breaker hold)
        box.unpause();
        uint256 hold = box.resumedAt();
        assertEq(hold, (DAY0 + 5) * 1 days, "breaker hold to 00:00 UTC is kept by unpause");
        vm.warp(hold + 1 days - 1);
        assertEq(box.sealedRefundAt(M1), p + 3 days);
        vm.prank(bob);
        box.refundSealed(M1, 1);
    }

    /// An unpaused trip after a pause clock lapsed starts a new clock at the trip (never revives the old one), and a
    /// guardian pause the next day keeps the trip's clock: one continuous stop, one clock.
    function test_sound_tripThenPauseIsOneStop() public {
        box.setLimits(2000 ether, 1);
        vm.warp(T0 + 1 hours);
        box.pause();
        vm.warp(T0 + 2 hours);
        box.unpause();
        // two days of service: the old clock lapses
        vm.warp(T0 + 2 days + 3 hours);
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        _play(bob, M1, 1);
        vm.warp(T0 + 2 days + 4 hours);
        box.retry(id); // trip, unpaused
        uint256 trip = T0 + 2 days + 4 hours;
        assertEq(box.pausedSince(), trip, "new clock at the trip, the lapsed pause is not revived");
        vm.warp(T0 + 2 days + 20 hours); // next UTC day (04:00), within a day of the breaker's 00:00 hold
        box.pause();
        assertEq(box.pausedSince(), trip, "the pause continues the trip's stop");
        vm.warp(trip + 3 days);
        vm.prank(bob);
        box.refundSealed(M1, 1);
    }

    /// setPolicy hold + trip while paused + unpause: the clock counts until the later of the two holds + 1 day.
    function test_sound_swapHoldAndTripWhilePaused() public {
        box.setLimits(2000 ether, 1);
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        _play(bob, M1, 1);
        vm.warp(T0 + 30);
        box.pause();
        MockPriceSource alt = new MockPriceSource();
        address[] memory t = new address[](2);
        uint256[] memory px = new uint256[](2);
        (t[0], t[1], px[0], px[1]) = (address(nvda), address(tsla), 200e6, 400e6);
        alt.setPrices(t, px);
        box.setPolicy(IPriceSource(address(alt)), 50 ether);
        vm.warp(T0 + 61);
        box.retry(id); // trip while paused
        box.setPolicy(IPriceSource(address(prices)), 50 ether); // swap back: holds again from now
        box.unpause();
        assertEq(box.pausedSince(), T0 + 30);
        assertEq(box.resumedAt(), T0 + 61 + 4 days, "the later swap hold wins over the breaker hold");
        vm.warp(T0 + 61 + 5 days - 1);
        box.setPrizes(M1, _table(address(nvda), P1));
        assertEq(box.sealedRefundAt(M1), T0 + 30 + 3 days);
        vm.prank(bob);
        box.refundSealed(M1, 1);
        vm.warp(T0 + 61 + 5 days);
        assertGt(box.sealedRefundAt(M1), T0 + 61 + 5 days, "then a day of service ends the stop");
    }

    // ================================================================== verified sound: settle pause rule

    /// A fresh IOU booked while already paused neither unpauses nor touches the clock; the owner's unpause with the
    /// IOU unfunded is owner trust, and the next fresh IOU pauses again inside the same stop (clock kept).
    function test_sound_freshIouWhilePausedKeepsClock() public {
        box.setJit(address(0), 0, 0, 0, 0);
        vm.deal(address(box), 0);
        box.sweep(address(nvda), address(this), nvda.balanceOf(address(box)));
        _play(alice, M1, 2);
        uint256 fee = vrf.fee();
        vm.prank(alice);
        (uint256 a, uint256 ra) = box.open{value: fee}(M1, 1, 0);
        vm.warp(T0 + 10);
        box.pause(); // guardian, unrelated
        vrf.fulfill(ra, _wordFor(1));
        vm.prank(alice);
        box.reveal(a); // IOU while paused
        assertGt(box.owed(alice), 0);
        assertEq(box.pausedSince(), T0 + 10);
        vm.warp(T0 + 1 hours);
        box.unpause(); // unfunded: owner's call
        vm.prank(alice);
        (uint256 a2, uint256 ra2) = box.open{value: fee}(M1, 1, 0);
        vrf.fulfill(ra2, _wordFor(1));
        vm.warp(T0 + 2 hours);
        vm.prank(alice);
        box.reveal(a2); // a fresh IOU: pauses, same stop
        assertTrue(box.paused());
        assertEq(box.pausedSince(), T0 + 10);
    }

    // ================================================================== verified sound: off clock

    /// sold != 0: switching on (any number of times) never drops or shortens the off clock; only extends the
    /// window. sold == 0 drops only the never-sold machine's clock, not another machine's.
    function test_sound_offClockSoldRule() public {
        box.setPrizes(M2, _table(address(nvda), P2));
        _play(alice, M1, 1);
        box.setMachineActive(M1, false);
        box.setMachineActive(M2, false); // never sold
        vm.warp(T0 + 1 hours);
        box.setMachineActive(M1, true);
        box.setMachineActive(M2, true);
        vm.warp(T0 + 20 hours);
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setMachineActive(M1, true); // again: onSince moves forward, clock kept longer
        vm.warp(T0 + 30 hours);
        box.setMachineActive(M1, false);
        assertEq(box.sealedRefundAt(M1), T0 + 3 days, "M1 keeps the first off clock");
        assertEq(box.sealedRefundAt(M2), T0 + 1 days + 3 days, "M2: only its table clock");
        vm.warp(T0 + 3 days);
        vm.prank(alice);
        box.refundSealed(M1, 1);
    }

    // ================================================================== verified sound: saturation

    /// Saturation never blocks retry or return (no overflow), every saturated miss re-trips without moving a
    /// running clock, and the counter rolls over at 00:00 UTC.
    function test_sound_saturatedMissesKeepClockAndRollOver() public {
        box.setLimits(2000 ether, 1);
        _play(alice, M1, 5);
        uint256[] memory ids = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            (ids[i],) = _open(alice, M1, 1);
        }
        vm.warp(T0 + 61);
        for (uint256 i; i < 5; ++i) {
            box.retry(ids[i]);
        }
        assertEq(_misses(), 1);
        assertEq(box.pausedSince(), T0 + 61);
        vm.expectRevert(Arclaw.VrfMisses.selector);
        this.openAs(alice);
        vm.warp((DAY0 + 1) * 1 days);
        assertEq(_misses(), 0);
    }

    function openAs(address who) external {
        _play(who, M1, 1);
        _open(who, M1, 1);
    }
}
