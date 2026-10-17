// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {MockPriceSource} from "../src/mocks/MockPriceSource.sol";
import {MockAstockDesk} from "../src/mocks/MockAstockDesk.sol";
import {MockVRFCoordinator} from "../src/mocks/MockVRFCoordinator.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {Vm} from "forge-std/Vm.sol";

abstract contract Base is Test {
    Arclaw box;
    MockVRFCoordinator vrf;
    MockPriceSource prices;
    MockAstockDesk desk;
    MockStock nvda; // $200
    MockStock tsla; // $400

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address op = makeAddr("operator");

    uint256 constant M1 = 1; // $1 machine
    uint256 constant M2 = 2; // $5 machine
    uint256 constant P1 = 1 ether;
    uint256 constant P2 = 5 ether;
    uint256 constant SUBSIDY = 0.1 ether;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        vrf = new MockVRFCoordinator();
        box = new Arclaw("ipfs://box/{id}", address(vrf), SUBSIDY);
        prices = new MockPriceSource();
        desk = new MockAstockDesk(IPriceSource(address(prices)));
        nvda = new MockStock("NVDA.arc");
        tsla = new MockStock("TSLA.arc");
        nvda.setMinter(address(desk), true);
        tsla.setMinter(address(desk), true);

        address[] memory t = new address[](2);
        uint256[] memory p = new uint256[](2);
        (t[0], t[1], p[0], p[1]) = (address(nvda), address(tsla), 200e6, 400e6);
        prices.setPrices(t, p);

        box.setPolicy(IPriceSource(address(prices)), 50 ether);
        box.setOperator(op);
        box.setSink(address(desk), true);
        box.setMachine(M1, uint128(P1), 5000, 100_000, 6000, 8500);
        box.setMachine(M2, uint128(P2), 5000, 100_000, 6000, 8500);

        nvda.mint(address(box), 100 ether);
        tsla.mint(address(box), 100 ether);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    // ---------------------------------------------------------------- table helpers

    /// A pack of 3 cards of `token` worth `value` (USDC 18 dp), split 40/40/20 exactly at the mock price.
    function _pack(address token, uint88 weight, uint8 tier, uint256 value)
        internal
        view
        returns (Arclaw.OutcomeInput memory o)
    {
        uint256 px = prices.priceOf(token);
        o.weight = weight;
        o.tier = tier;
        uint256 v0 = value * 40 / 100;
        uint256 v2 = value - 2 * v0;
        (o.tokens[0], o.tokens[1], o.tokens[2]) = (token, token, token);
        o.amounts[0] = v0 * 1e6 / px;
        o.amounts[1] = v0 * 1e6 / px;
        o.amounts[2] = v2 * 1e6 / px;
    }

    /// Common 0.5x (weight 3) + Big 1.5x (weight 1): EV 0.75x.
    function _table(address token, uint256 price) internal view returns (Arclaw.OutcomeInput[] memory t) {
        t = new Arclaw.OutcomeInput[](2);
        t[0] = _pack(token, 3, 0, price / 2);
        t[1] = _pack(token, 1, 1, price * 3 / 2);
    }

    /// Single outcome of `value`; rules relaxed on the machine so any value lands (for payout plumbing tests).
    function _forceSingle(uint256 machineId, address token, uint256 value) internal {
        (uint128 price,,,,) = box.machines(machineId);
        uint16 bps = uint16(value * 10_000 / price); // tests keep this within [3000, 9500]
        box.setMachine(machineId, price, 3000, 1_000_000, bps, bps);
        Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](1);
        t[0] = _pack(token, 1, 0, value);
        box.setPrizes(machineId, t);
    }

    // ---------------------------------------------------------------- flow helpers

    function _play(address who, uint256 machineId, uint256 n) internal {
        (uint128 price,,,,) = box.machines(machineId);
        vm.prank(who);
        box.play{value: n * price}(machineId, n);
    }

    function _open(address who, uint256 machineId, uint256 n) internal returns (uint256 openingId, uint256 requestId) {
        vm.prank(who);
        (openingId, requestId) = box.open(machineId, n);
    }

    function _status(uint256 id) internal view returns (Arclaw.OpeningStatus s) {
        (,,,, s,,,) = box.openings(id);
    }

    function _countEvents(Vm.Log[] memory logs, bytes32 sig) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(box) && logs[i].topics[0] == sig) ++n;
        }
    }
}
