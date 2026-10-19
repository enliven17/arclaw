// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// A misbehaving or owner-swapped price source: every token is worth 1 micro-dollar.
contract DustSource {
    function priceOf(address) external pure returns (uint256) {
        return 1;
    }
}

/// A price source that always reverts (stale, unmapped, or deliberately broken).
contract DeadSource {
    function priceOf(address) external pure returns (uint256) {
        revert("dead");
    }
}

/// Audit 7b findings. Absolute warps (via_ir re-reads block.timestamp).
contract A7bFindingsTest is Base {
    uint256 constant T0 = 1_800_000_000; // Base.setUp warp

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1)); // priced at T0, maxTableAge 1 day
    }

    function _misses() internal view returns (uint256 m) {
        (, m,,,) = box.limits();
    }

    // ------------------------------------------------------------------ H-01

    /// Contrast: the documented path. Two withheld words returned before RESCUE_AFTER trip a 2-miss breaker, which
    /// closes `open` for the rest of the UTC day (round 5: no global pause).
    function test_H01_control_documentedPathTripsBreaker() public {
        box.setLimits(2000 ether, 2);
        _play(alice, M1, 3);
        (uint256 a,) = _open(alice, M1, 1);
        (uint256 b,) = _open(alice, M1, 1);
        vm.warp(T0 + 1 days + 61); // expired, table aged out
        vm.prank(alice);
        box.returnBoxes(a);
        vm.prank(alice);
        box.returnBoxes(b);
        assertEq(_misses(), 2);
        assertFalse(box.paused(), "no pause");
        box.setPrizes(M1, _table(address(nvda), P1));
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(Arclaw.VrfMisses.selector);
        box.open(M1, 1, tid); // the breaker stops the reopen
    }

    /// H-01 (was: a return after RESCUE_AFTER skipped _miss, a miss-free re-roll). Fixed in round 5: every return
    /// path books the opening's miss, on the day of the return, so the 7-day path trips the breaker like any other.
    function test_fixed_H01_sevenDayReturnCountsAMiss() public {
        box.setLimits(2000 ether, 2); // the breaker trips on the 2nd miss
        uint256 n = 6;
        _play(alice, M1, n);

        uint256 openedAt = T0 + 1 days - 30; // table still fresh, request deadline lands after it is stale
        vm.warp(openedAt);
        uint256[] memory ids = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            (ids[i],) = _open(alice, M1, 1);
        }

        // the prover saw the words and withheld them all; the house keeper cannot retry
        vm.warp(openedAt + 61);
        vm.expectRevert(Arclaw.TableStale.selector);
        box.retry(ids[0]);

        // RESCUE_AFTER later every opening comes back sealed, each one a miss booked today
        vm.warp(openedAt + 7 days + 1);
        for (uint256 i; i < n; ++i) {
            vm.prank(alice);
            box.returnBoxes(ids[i]);
        }
        // six misses booked; the counter saturates at maxMisses (round 6, 8a I-01)
        assertEq(_misses(), 2, "six withheld words, the breaker tripped");
        assertEq(box.balanceOf(alice, M1), n);

        // and the re-roll is stopped for the day
        box.setPrizes(M1, _table(address(nvda), P1));
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(Arclaw.VrfMisses.selector);
        box.open(M1, 1, tid);
    }

    // ------------------------------------------------------------------ M-01

    /// M-01: a compromised owner (or a lying oracle for short cards) zeroes a fulfilled opening's payout without an IOU:
    /// sweep the card stock, point the price source at a dust price, and the refund is value * 1 / refPrice. The box
    /// price that pendingReserve held for the opener becomes free balance and is withdrawn.
    function test_M01_ownerZeroesPendingOpeningWithoutIou() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        assertEq(box.pendingReserve(), P1, "price reserved for the opener");

        address thief = makeAddr("thief");
        box.sweep(address(nvda), thief, nvda.balanceOf(address(box)));
        box.sweep(address(tsla), thief, tsla.balanceOf(address(box)));
        // round 5: a source swap needs a pause (one batch), and it runs the refund clock; the zeroing still works:
        // owner trust, documented in docs/SECURITY.md (Owner Safe, later a Safe delay module)
        box.pause();
        box.setPolicy(IPriceSource(address(new DustSource())), 0);
        box.unpause();

        uint256 before = alice.balance;
        box.reveal(id); // keeper, or alice herself: same result
        assertEq(nvda.balanceOf(alice), 0, "no stock");
        assertLt(alice.balance - before, 1e10, "refund is dust (< 0.00000001 USDC)");
        assertEq(box.totalOwed(), 0, "no IOU either");

        uint256 free = box.freeBalance();
        assertGt(free, P1 * 9 / 10, "the reserved box price is now free");
        box.withdraw(thief, free);
        assertEq(thief.balance, free);
    }

    // ------------------------------------------------------------------ L-01

    /// L-01 (was: the owner traps sealed boxes with a daily good/dead source swap, no clock ever runs). Fixed in
    /// round 5: the swap needs a pause, and the swap holds the pause clock, so refundSealed opens 3 days after the
    /// first batch however the batches are spaced.
    function test_fixed_L01_sourceSwapCannotTrapSealedBoxes() public {
        _play(alice, M1, 1);
        IPriceSource good = IPriceSource(address(prices));
        IPriceSource dead = IPriceSource(address(new DeadSource()));
        vm.expectRevert(Pausable.ExpectedPause.selector);
        box.setPolicy(dead, 50 ether);

        uint256 first = T0 + 1 days - 1 hours;
        for (uint256 d = 1; d <= 4; ++d) {
            vm.warp(T0 + d * 1 days - 1 hours);
            box.pause();
            box.setPolicy(good, 50 ether);
            box.setPrizes(M1, _table(address(nvda), P1));
            box.setPolicy(dead, 50 ether);
            box.unpause();

            uint256 tid = box.currentTable(M1) - 1;
            vm.prank(alice);
            vm.expectRevert(); // the live check cannot price the cards
            box.open(M1, 1, tid);
        }
        assertEq(box.pausedSince(), first);
        assertEq(box.sealedRefundAt(M1), first + 3 days, "the exit no longer moves out");
        vm.prank(alice);
        box.refundSealed(M1, 1);
    }
}
