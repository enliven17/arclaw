// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";

/// Auditor 3a: what a sealed box (or an open in the mempool) is actually promised.
/// These tests document CURRENT behaviour (the finding); flip them when fixed.
contract A3aTableTest is Base {
    function _single(address token, uint256 value) internal view returns (Arclaw.OutcomeInput[] memory t) {
        t = new Arclaw.OutcomeInput[](1);
        t[0] = _pack(token, 1, 0, value);
    }

    function _tableId(uint256 openingId) internal view returns (uint256 t) {
        (,, uint32 tid,,,,,) = box.openings(openingId);
        t = tid;
    }

    /// M-01: open() has no expected-table parameter. The operator (a hot treasury key) or any keeper reprice that
    /// lands first decides the table the player's boxes are frozen against. Displayed 75% table, served 60%.
    function test_m01_openCanBeFrontRunWithMinRtpTable() public {
        box.setPrizes(M2, _table(address(nvda), P2)); // EV 0.75x: what the site shows
        uint256 shown = box.currentTable(M2) - 1;
        _play(alice, M2, 1);

        // alice's open is in the mempool; the operator front-runs with a band-legal 0.60x-only table
        Arclaw.OutcomeInput[] memory worst = _single(address(nvda), P2 * 6000 / 10_000);
        vm.prank(op);
        box.operatorSetPrizes(M2, worst);

        (uint256 id, uint256 req) = _open(alice, M2, 1);
        assertTrue(_tableId(id) != shown, "frozen against a table alice never saw");
        vrf.fulfill(req, keccak256("any"));
        uint256 before = nvda.balanceOf(alice);
        box.reveal(id);
        // 0.60 x 5 USDC of NVDA at $200 = 0.015 NVDA, every time, vs 0.75x expected on the shown table
        assertApproxEqAbs(nvda.balanceOf(alice) - before, 0.015 ether, 3);
    }

    /// M-02: the price is immutable, but the rules are not. The owner can re-rate boxes already sold by moving the
    /// machine to floor = cap = band = 30% (MIN_FLOOR_BPS) and setting a 0.30x table. This is the same harm H-01
    /// fixed for price, and 30% is below the product promise of "at least 50% back".
    function test_m02_ruleChangeReRatesSoldBoxesTo30Percent() public {
        box.setPrizes(M1, _table(address(nvda), P1)); // sold under 50% floor, 60-85% band
        _play(alice, M1, 10);

        box.setMachine(M1, uint128(P1), 3000, 3000, 3000, 3000);
        box.setPrizes(M1, _single(address(nvda), P1 * 3000 / 10_000));

        (uint256 id, uint256 req) = _open(alice, M1, 10);
        vrf.fulfill(req, keccak256("w"));
        box.reveal(id);
        // 10 boxes x 0.30 USDC of NVDA at $200 = 0.015 NVDA for 10 USDC paid
        assertApproxEqAbs(nvda.balanceOf(alice), 0.015 ether, 30);
    }
}
