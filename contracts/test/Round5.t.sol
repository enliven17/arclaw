// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ID20Coordinator} from "../src/vrf/D20Randomness.sol";

/// Round 5 (audits 7a / 7b): one miss per opening on every return path, the day-scoped open breaker and its refund
/// clock, setPolicy only while paused, the VRF subsidy only from the unreserved balance.
contract Round5Test is Base {
    uint256 constant T0 = 1_800_000_000; // Base.setUp warp; absolute warps (via_ir re-reads block.timestamp)
    uint256 constant DAY0 = T0 / 1 days; // T0 is 16:00 UTC

    receive() external payable {}

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1));
    }

    /// Misses booked today (limits rolls over on the next write, so an older day reads as 0 here).
    function _misses() internal view returns (uint256 m) {
        uint32 day;
        (day, m,,,) = box.limits();
        if (day != block.timestamp / 1 days) m = 0;
    }

    // ------------------------------------------------------------------ fix 1: one miss per opening

    function test_miss_retryThenReturnCountsOnce() public {
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(T0 + 61);
        box.retry(id);
        assertEq(_misses(), 1);
        vm.warp(T0 + 1 days + 200); // the retry expired too, the table aged out (a later UTC day)
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(_misses(), 0, "nothing booked on the return day");
    }

    function test_miss_retryThenSevenDayReturnCountsOnce() public {
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(T0 + 61);
        box.retry(id);
        vm.warp(T0 + 8 days); // the retried request lost too: the 7-day path
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(ID20Coordinator.getRequest.selector), "dead");
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(_misses(), 0);
    }

    function test_miss_unretriedSevenDayReturnCounts() public {
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(T0 + 8 days); // plain expired request, never retried
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(_misses(), 1);
    }

    // ------------------------------------------------------------------ fix 2: breaker and its refund clock

    /// A VRF that misses every day trips the breaker every day: the clock started by the first trip keeps running,
    /// so sealed boxes become refundable 3 days after it, without anyone pausing.
    function test_breaker_dailyTripsOpenRefundSealed() public {
        box.setLimits(2000 ether, 1);
        _play(bob, M1, 1); // a holder who just wants out
        uint256 firstTrip;
        for (uint256 d; d < 4; ++d) {
            uint256 t = (DAY0 + d + 1) * 1 days + 1 hours; // 01:00 UTC each day
            vm.warp(t);
            box.setPrizes(M1, _table(address(nvda), P1));
            _play(alice, M1, 1);
            (uint256 id,) = _open(alice, M1, 1);
            vm.warp(t + 61);
            box.retry(id); // the keeper: one miss trips (maxMisses 1)
            if (d == 0) firstTrip = t + 61;
            assertEq(box.pausedSince(), firstTrip, "the clock keeps its start");
        }
        assertFalse(box.paused());
        assertEq(box.sealedRefundAt(M1), firstTrip + 3 days);
        vm.warp(firstTrip + 3 days);
        vm.prank(bob);
        box.refundSealed(M1, 1);
    }

    /// A single trip runs the clock only until a day after its 00:00 UTC end: a lone hiccup does not open refunds.
    function test_breaker_singleTripClockLapses() public {
        box.setLimits(2000 ether, 1);
        _play(alice, M1, 2);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(T0 + 61);
        box.retry(id);
        uint256 midnight = (DAY0 + 1) * 1 days;
        assertEq(box.resumedAt(), midnight);
        vm.warp(midnight + 1 days); // clock no longer counts; the table (priced at T0) went stale at T0 + 1 day
        assertEq(box.sealedRefundAt(M1), T0 + 1 days + 3 days, "back to the table clock");
    }

    /// Unpause never moves resumedAt back (a breaker hold or a swap hold stays).
    function test_unpauseKeepsALaterHold() public {
        box.setLimits(2000 ether, 1);
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(T0 + 61);
        box.retry(id);
        box.pause();
        box.unpause();
        assertEq(box.resumedAt(), (DAY0 + 1) * 1 days);
    }

    // ------------------------------------------------------------------ fix 3: setPolicy only while paused

    function test_policy_freshContractSetsSourceUnpaused() public {
        Arclaw b2 = new Arclaw("", address(vrf), SUBSIDY);
        b2.setPolicy(IPriceSource(address(prices)), 1 ether); // no table yet: deploy flow
        b2.setPolicy(IPriceSource(address(0)), 1 ether);
        assertEq(address(b2.priceSource()), address(0));
    }

    function test_policy_swapNeedsPauseCapDoesNot() public {
        vm.expectRevert(Pausable.ExpectedPause.selector);
        box.setPolicy(IPriceSource(address(0)), 50 ether);
        box.setPolicy(IPriceSource(address(prices)), 9 ether); // same source: cap only
        assertEq(box.dailyCap(), 9 ether);
        assertEq(box.resumedAt(), 0, "no hold without a swap");

        box.pause();
        box.setPolicy(IPriceSource(address(1)), 9 ether);
        assertEq(box.resumedAt(), T0 + 4 days, "a swap holds the pause clock 3 + 1 days");
        box.unpause();
        assertEq(box.resumedAt(), T0 + 4 days, "unpause keeps the hold");
    }

    // ------------------------------------------------------------------ fix 4: subsidy only from unreserved funds

    /// The opener's own top-up, refunded by D20 on expiry, is never counted as house money for the retry's subsidy.
    function test_subsidy_retryDoesNotUseTheOpenersRefundedTopUp() public {
        box.setJit(address(0), 0, 0, 0, 0);
        vm.deal(address(box), 0); // no float
        _play(alice, M1, 1);
        uint256 fee = vrf.fee();
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        (uint256 id,) = box.open{value: fee}(M1, 1, tid); // full fee: no float
        assertEq(box.openingTopUp(id), fee);
        vm.warp(T0 + 61);
        // D20 refunds alice's fee into the contract during retry; it is hers, not a subsidy
        vm.expectRevert(abi.encodeWithSelector(Arclaw.VrfFeeTopUp.selector, fee, 0));
        box.retry(id); // keeper, no value
        uint256 a0 = alice.balance;
        box.retry{value: fee}(id); // the keeper pays itself
        assertEq(alice.balance - a0, fee, "alice's top-up paid back");
        assertEq(address(box).balance, 1 ether, "box price still fully backed");
    }

    /// With a float, the subsidy is paid as before.
    function test_subsidy_paidFromFloat() public {
        _play(alice, M1, 1);
        uint256 bal = address(box).balance;
        _open(alice, M1, 1);
        assertEq(bal - address(box).balance, vrf.fee(), "house paid the fee from the float");
        assertEq(box.topUpReserve(), 0);
    }
}
