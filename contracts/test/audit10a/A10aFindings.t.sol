// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";

/// Audit round 10, reviewer A: unit-level proofs (mocks from Base.t.sol).
contract A10aFindingsTest is Base {
    address guardianKey = makeAddr("guardian");

    function setUp() public override {
        super.setUp();
        box.setGuardian(guardianKey);
        Arclaw.OutcomeInput[] memory t = _table(address(nvda), P1);
        vm.prank(op);
        box.operatorSetPrizes(M1, t);
    }

    /// L-02: a stolen operator key reprices ahead of every open. Each reprice is band-legal, so it lands; every open
    /// that quotes the table the player saw reverts TableChanged, and because every reprice also refreshes
    /// tablePricedAt, the "stale table" exit of refundSealed never starts. Machine on, contract unpaused: no clock.
    function test_L02_operatorRepriceChurnStallsOpensWithNoExitClock() public {
        _play(alice, M1, 5);
        uint256 shown = box.currentTable(M1) - 1;

        for (uint256 day; day < 10; ++day) {
            // the operator's transaction lands first in the block of alice's open
            Arclaw.OutcomeInput[] memory t = _table(address(nvda), P1);
            vm.prank(op);
            box.operatorSetPrizes(M1, t);
            vm.prank(alice);
            vm.expectRevert(Arclaw.TableChanged.selector);
            box.open(M1, 1, shown);
            shown = box.currentTable(M1) - 1; // she re-reads and tries again next time: same story
            vm.warp(block.timestamp + 1 days - 1 hours);
        }

        // ten days without a single open, and sealed boxes still have no exit
        assertGt(box.sealedRefundAt(M1), block.timestamp, "refund clock never started");
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M1, 5);
        assertEq(box.balanceOf(alice, M1), 5, "boxes stuck sealed");
    }

    /// L-02 contrast: the only on-chain way out is the guardian (or owner) acting: a pause starts the clock.
    function test_L02_contrast_guardianPauseStartsTheClock() public {
        _play(alice, M1, 5);
        vm.prank(guardianKey);
        box.pause();
        vm.warp(block.timestamp + 3 days);
        // the operator keeps the table fresh; the pause clock wins anyway
        Arclaw.OutcomeInput[] memory t = _table(address(nvda), P1);
        vm.prank(op);
        box.operatorSetPrizes(M1, t);
        uint256 before = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 5);
        assertEq(alice.balance - before, 5 * P1, "refunded at price");
    }
}
