// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";

/// Auditor 3a: what a sealed box (or an open in the mempool) is actually promised.
/// Flipped: each test now asserts the FIXED behaviour on the auditor's scenario.
contract A3aTableTest is Base {
    function _single(address token, uint256 value) internal view returns (Arclaw.OutcomeInput[] memory t) {
        t = new Arclaw.OutcomeInput[](1);
        t[0] = _pack(token, 1, 0, value);
    }

    /// M-01 fixed: open() takes the table id the player was shown. A reprice that lands first (operator or keeper
    /// front-run with a band-legal 0.60x table) makes the open revert instead of freezing it against that table.
    function test_fixed_m01_openRevertsIfTableChanged() public {
        box.setPrizes(M2, _table(address(nvda), P2)); // EV 0.75x: what the site shows
        uint256 shown = box.currentTable(M2) - 1;
        _play(alice, M2, 1);

        // alice's open is in the mempool; the operator front-runs with a band-legal 0.60x-only table
        Arclaw.OutcomeInput[] memory worst = _single(address(nvda), P2 * 6000 / 10_000);
        vm.prank(op);
        box.operatorSetPrizes(M2, worst);

        vm.prank(alice);
        vm.expectRevert(Arclaw.TableChanged.selector);
        box.open(M2, 1, shown);
        assertEq(box.balanceOf(alice, M2), 1, "box still sealed");
        assertEq(box.pendingReserve(), 0);
    }

    /// M-02 fixed: once a machine exists its floor and RTP lower bound only move up, and no floor is under 50%. The
    /// auditor's re-rate (floor = cap = band = 30%, then a 0.30x table) is impossible in every variant.
    function test_fixed_m02_rulesCannotReRateSoldBoxes() public {
        box.setPrizes(M1, _table(address(nvda), P1)); // sold under 50% floor, 60-85% band
        _play(alice, M1, 10);

        vm.expectRevert(Arclaw.BadMachine.selector); // under MIN_FLOOR_BPS (50%)
        box.setMachine(M1, uint128(P1), 3000, 3000, 3000, 3000);
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setMachine(M1, uint128(P1), 4999, 100_000, 6000, 8500);
        vm.expectRevert(Arclaw.RuleLowered.selector); // rtpMin 60% -> 50%
        box.setMachine(M1, uint128(P1), 5000, 100_000, 5000, 8500);

        // up is fine, and then it is the new minimum
        box.setMachine(M1, uint128(P1), 5500, 100_000, 6500, 8500);
        vm.expectRevert(Arclaw.RuleLowered.selector);
        box.setMachine(M1, uint128(P1), 5000, 100_000, 6500, 8500);
        // cap and rtpMax may still move either way inside the bounds
        box.setMachine(M1, uint128(P1), 5500, 50_000, 6500, 8000);
        box.setMachine(M1, uint128(P1), 5500, 100_000, 6500, 8500);

        Arclaw.OutcomeInput[] memory thirty = _single(address(nvda), P1 * 3000 / 10_000);
        vm.expectPartialRevert(Arclaw.BelowFloor.selector);
        box.setPrizes(M1, thirty);
    }
}
