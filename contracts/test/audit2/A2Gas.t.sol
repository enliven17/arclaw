// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {MockStock} from "../../src/mocks/MockStock.sol";
import {MockPriceSource} from "../../src/mocks/MockPriceSource.sol";
import {MockVRFCoordinator} from "../../src/mocks/MockVRFCoordinator.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";
import {ID20Coordinator} from "../../src/vrf/D20Randomness.sol";

/// Worst-case gas with cold storage (vm.cool), fresh opener (every card is a zero -> non-zero SSTORE),
/// 8 distinct stocks. Arc mainnet block gas limit: 30,000,000 (read 2026-10-17). D20 forwards exactly
/// callbackGasLimit (default 100,000) to rawFulfillRandomness.
contract A2GasTest is Test {
    Arclaw box;
    MockVRFCoordinator vrf;
    MockPriceSource ps;
    MockStock[8] stk;
    uint256 constant M = 3;
    uint256 constant PRICE = 10 ether;
    uint256 constant ARC_BLOCK_GAS = 30_000_000;

    function setUp() public {
        vm.warp(1_800_000_000);
        vrf = new MockVRFCoordinator();
        box = new Arclaw("", address(vrf), 0.05 ether);
        ps = new MockPriceSource();
        address[] memory t = new address[](8);
        uint256[] memory p = new uint256[](8);
        for (uint256 i; i < 8; ++i) {
            stk[i] = new MockStock("X.arc");
            stk[i].mint(address(box), 1e30);
            (t[i], p[i]) = (address(stk[i]), (100 + 37 * i) * 1e6);
        }
        ps.setPrices(t, p);
        box.setPolicy(IPriceSource(address(ps)), 0);
        box.setMachine(M, uint128(PRICE), 5000, 100_000, 6000, 8500);
        box.setKeeper(address(this), true); // reveals like the house bot
    }

    /// n outcomes, all worth 0.75x, cards on 3 distinct stocks rotating over 8. Last outcome weight `lastW`.
    function _table(uint256 n, uint88 lastW) internal view returns (Arclaw.OutcomeInput[] memory t) {
        t = new Arclaw.OutcomeInput[](n);
        uint256 v = PRICE * 3 / 4 / 3;
        for (uint256 k; k < n; ++k) {
            t[k].weight = k == n - 1 ? lastW : 1;
            for (uint256 c; c < 3; ++c) {
                MockStock s = stk[(k + c * 3) % 8];
                uint256 px = ps.priceOf(address(s));
                t[k].tokens[c] = address(s);
                t[k].amounts[c] = (v * 1e6 + px - 1) / px;
            }
        }
    }

    function _coolAll() internal {
        vm.cool(address(box));
        vm.cool(address(vrf));
        for (uint256 i; i < 8; ++i) vm.cool(address(stk[i]));
    }

    function _run(uint256 outcomes, uint88 lastW, string memory label) internal returns (uint256 gOpen, uint256 gCb, uint256 gReveal) {
        box.setPrizes(M, _table(outcomes, lastW));
        address p = makeAddr(label);
        vm.deal(p, 1000 ether);
        vm.prank(p);
        box.play{value: 20 * PRICE}(M, 20);

        uint256 shown = box.currentTable(M) - 1;
        _coolAll();
        uint256 g = gasleft();
        vm.prank(p);
        (uint256 id, uint256 req) = box.open(M, 20, shown);
        gOpen = g - gasleft();

        _coolAll();
        vm.prank(address(vrf));
        g = gasleft();
        box.rawFulfillRandomness(req, keccak256(abi.encode(label)));
        gCb = g - gasleft();

        _coolAll();
        g = gasleft();
        box.reveal(id);
        gReveal = g - gasleft();
        console.log(label);
        console.log("  open(20)   ", gOpen);
        console.log("  callback   ", gCb);
        console.log("  reveal(20) ", gReveal);
    }

    function test_gas_open20_reveal20_eightStocks() public {
        (uint256 o, uint256 cb, uint256 r) = _run(6, 1, "6 outcomes, 8 stocks");
        assertLt(o, 500_000);
        assertLt(cb, 60_000, "callback well under the 100k callbackGasLimit");
        assertLt(r, ARC_BLOCK_GAS / 4);
    }

    /// Largest allowed table (MAX_OUTCOMES = 64), mass on the last one, so _draw scans the whole table every box.
    function test_gas_reveal20_largeTableFullScan() public {
        (,, uint256 r) = _run(64, 1_000_000, "64 outcomes, full scan");
        assertLt(r, ARC_BLOCK_GAS / 2);
    }

    /// The real coordinator path: the callback succeeds at the minimum allowed limit (30k) only if it fits.
    function test_gas_callbackDeliveredAtDefaultAndReportsMinimum() public {
        box.setPrizes(M, _table(6, 1));
        address p = makeAddr("p");
        vm.deal(p, 1000 ether);
        vm.prank(p);
        box.play{value: PRICE}(M, 1);

        uint256 shown = box.currentTable(M) - 1;
        vm.prank(p);
        (, uint256 req) = box.open(M, 1, shown);
        _coolAll();
        assertTrue(vrf.fulfill(req, keccak256("w")), "delivered at callbackGasLimit 100k");

        box.setVrfConfig(30_000, 0.05 ether); // D20 minimum
        vm.prank(p);
        box.play{value: PRICE}(M, 1);
        uint256 shown2 = box.currentTable(M) - 1;
        vm.prank(p);
        (, uint256 req2) = box.open(M, 1, shown2);
        _coolAll();
        bool ok = vrf.fulfill(req2, keccak256("w2"));
        ID20Coordinator.Request memory r = vrf.getRequest(req2);
        console.log("delivered at 30k callback gas:", ok);
        assertTrue(r.fulfilled, "word is final even if the 30k callback fails; reveal reads it");
    }
}
