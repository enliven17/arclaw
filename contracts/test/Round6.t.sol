// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Arclaw} from "../src/Arclaw.sol";

/// Round 6 (audits 8a / 8b): the pause clock is the running pause's (a trip while paused is a no-op), only a new IOU
/// or a short buffer pauses at settle, the miss counter saturates, and a never-sold machine drops its off clock when
/// switched on. Absolute warps only (via_ir re-reads block.timestamp). T0 is 08:00 UTC.
contract Round6Test is Base {
    uint256 constant T0 = 1_800_000_000;
    uint256 constant DAY0 = T0 / 1 days;

    receive() external payable {}

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1)); // table 0, priced at T0
    }

    function _misses() internal view returns (uint256 m) {
        uint32 day;
        (day, m,,,) = box.limits();
        if (day != block.timestamp / 1 days) m = 0;
    }

    /// A word whose box 0 draws outcome `idx` of the 2-outcome _table (weights 3, 1).
    function _wordFor(uint256 idx) internal pure returns (bytes32 w) {
        for (uint256 i = 1;; ++i) {
            w = bytes32(i);
            uint256 r = uint256(keccak256(abi.encode(w, uint256(0)))) % 4;
            if ((idx == 1) == (r >= 3)) return w;
        }
    }

    function _reserves() internal view returns (uint256) {
        return box.reservedCredit() + box.pendingReserve() + box.sealedReserve() + box.topUpReserve() + box.totalOwed();
    }

    // ------------------------------------------------------------------ fix 1: _clock is a no-op while paused

    /// _pause still starts the clock: first pause, a re-pause inside SERVICE_RESET keeps it, a pause after a full day
    /// of service starts a new one.
    function test_clock_pauseStartsAndKeepsClock() public {
        vm.warp(T0 + 1 hours);
        box.pause();
        assertEq(box.pausedSince(), T0 + 1 hours, "first pause starts the clock");
        vm.warp(T0 + 2 hours);
        box.unpause();
        vm.warp(T0 + 3 hours);
        box.pause();
        assertEq(box.pausedSince(), T0 + 1 hours, "re-pause within a day of service keeps it");
        vm.warp(T0 + 4 hours);
        box.unpause();
        vm.warp(T0 + 4 hours + 1 days);
        box.pause();
        assertEq(box.pausedSince(), T0 + 4 hours + 1 days, "a pause after a day of service starts a new clock");
    }

    /// A trip while paused leaves the clock, still holds resumedAt to 00:00 UTC; unpause keeps that hold, and the
    /// pause clock lapses one day after it (round 5 semantics).
    function test_clock_tripWhilePausedThenUnpause() public {
        box.setLimits(2000 ether, 1);
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(T0 + 30);
        box.pause();
        vm.warp(T0 + 61);
        box.retry(id); // keeper, while paused: the trip
        assertEq(_misses(), 1);
        uint256 midnight = (DAY0 + 1) * 1 days;
        assertEq(box.pausedSince(), T0 + 30, "trip while paused: clock untouched");
        assertEq(box.resumedAt(), midnight, "the breaker day is still held");
        vm.warp(T0 + 2 hours);
        box.unpause();
        assertEq(box.resumedAt(), midnight, "unpause keeps the later hold");
        assertEq(box.sealedRefundAt(M1), T0 + 30 + 3 days);
        vm.warp(midnight + 1 days - 1);
        assertEq(box.sealedRefundAt(M1), T0 + 30 + 3 days, "clock counts until a day after the hold");
        vm.warp(midnight + 1 days);
        assertEq(box.sealedRefundAt(M1), T0 + 1 days + 3 days, "then back to the table clock");
    }

    /// Unpaused, a trip still starts the clock (the round 5 breaker clock is unchanged).
    function test_clock_tripWhileRunningStartsClock() public {
        box.setLimits(2000 ether, 1);
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(T0 + 61);
        box.retry(id);
        assertEq(box.pausedSince(), T0 + 61);
        assertFalse(box.paused());
    }

    // ------------------------------------------------------------------ fix 2: pause only on a new IOU or short buffer

    function _iouSetup() internal returns (uint256 iou) {
        box.setJit(address(0), 0, 0, 0, 0);
        vm.deal(address(box), 0);
        box.sweep(address(nvda), address(this), nvda.balanceOf(address(box)));
        _play(alice, M1, 1);
        uint256 tid = box.currentTable(M1) - 1;
        uint256 fee = vrf.fee();
        vm.prank(alice);
        (uint256 id, uint256 req) = box.open{value: fee}(M1, 1, tid);
        vrf.fulfill(req, _wordFor(1)); // 1.5x, all cards short, no float: an IOU
        vm.prank(alice);
        box.reveal(id);
        iou = box.owed(alice);
        assertGt(iou, 0);
        assertTrue(box.paused(), "a new IOU pauses");
    }

    /// With the old IOU funded, a reveal that creates a NEW IOU still pauses.
    function test_iou_newIouStillPauses() public {
        _iouSetup();
        (bool ok,) = address(box).call{value: 10 ether}("");
        assertTrue(ok);
        box.unpause();
        _play(bob, M1, 1);
        (uint256 b, uint256 rb) = _open(bob, M1, 1); // subsidy from the float
        vm.deal(address(box), _reserves()); // nothing unreserved: bob's refund cannot be covered
        vrf.fulfill(rb, _wordFor(1));
        box.reveal(b);
        assertGt(box.owed(bob), 0, "bob's refund is an IOU");
        assertTrue(box.paused(), "the new IOU pauses");
    }

    /// An unfunded old IOU with minBuffer set: the short buffer pauses the next settle.
    function test_iou_shortBufferPauses() public {
        _iouSetup();
        box.setGuards(500, 1 ether); // minBuffer above what the unfunded pool will hold
        box.unpause(); // the owner's call, unfunded
        nvda.mint(address(box), 100 ether);
        _play(bob, M1, 1);
        uint256 tid = box.currentTable(M1) - 1;
        uint256 fee = vrf.fee();
        vm.prank(bob);
        (uint256 b, uint256 rb) = box.open{value: fee}(M1, 1, tid);
        vrf.fulfill(rb, _wordFor(0)); // small pack, paid in stock: no new IOU
        box.reveal(b);
        assertEq(box.owed(bob), 0);
        assertTrue(box.paused(), "unreserved under minBuffer pauses");
    }

    // ------------------------------------------------------------------ fix 3: miss counter saturates

    function test_miss_counterSaturatesAtMax() public {
        box.setLimits(2000 ether, 2);
        _play(alice, M1, 4);
        uint256[] memory ids = new uint256[](4);
        for (uint256 i; i < 4; ++i) {
            (ids[i],) = _open(alice, M1, 1);
        }
        vm.warp(T0 + 61);
        for (uint256 i; i < 3; ++i) {
            box.retry(ids[i]);
        }
        assertEq(_misses(), 2, "saturated at maxMisses");
        box.setLimits(2000 ether, 5); // raised: counting resumes from the cap
        box.retry(ids[3]);
        assertEq(_misses(), 3);
    }

    // ------------------------------------------------------------------ fix 4: never-sold machine off clock

    /// A machine that sold boxes keeps its off clock across a switch back on (unchanged).
    function test_offClock_soldMachineKeepsClock() public {
        _play(alice, M1, 1);
        box.setMachineActive(M1, false);
        vm.warp(T0 + 1 hours);
        box.setMachineActive(M1, true);
        assertEq(box.sealedRefundAt(M1), T0 + 3 days, "off clock kept for a day of service");
    }

    /// A never-sold machine switched on drops the clock; a later switch-off starts a fresh one.
    function test_offClock_neverSoldThenOffAgainStartsFresh() public {
        box.setPrizes(M2, _table(address(nvda), P2));
        box.setMachineActive(M2, false);
        vm.warp(T0 + 10 days);
        box.setPrizes(M2, _table(address(nvda), P2));
        box.setMachineActive(M2, true);
        _play(alice, M2, 1);
        vm.warp(T0 + 10 days + 1 hours);
        box.setMachineActive(M2, false);
        assertEq(box.sealedRefundAt(M2), T0 + 10 days + 1 hours + 3 days, "fresh off clock");
    }
}
