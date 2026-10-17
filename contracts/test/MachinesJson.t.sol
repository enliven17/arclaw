// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {ArclawLens} from "../src/ArclawLens.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {MockPriceSource} from "../src/mocks/MockPriceSource.sol";
import {MockVRFCoordinator} from "../src/mocks/MockVRFCoordinator.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {ArcConfig} from "../script/Deploy.s.sol";

/// Exposes the deploy script's machines.json reader and pack builder.
contract Builder is ArcConfig {
    function policy() external view returns (Policy memory) {
        return readPolicy(vm.readFile(MACHINES));
    }

    function machinesCfg() external view returns (MachineCfg[] memory) {
        return readMachines(vm.readFile(MACHINES));
    }

    function buildFor(MachineCfg memory m, address[8] memory tok, uint256[8] memory px)
        external
        pure
        returns (Arclaw.OutcomeInput[] memory)
    {
        return buildTable(m, tok, px);
    }
}

/// Builds every machine in ../lib/machines.json with the deploy script's code and lands it under the on-chain rules.
/// Prints realised RTP, smallest and largest pack. Prices are awkward on purpose (rounding must not break the floor).
contract MachinesJsonTest is Test {
    Builder b;
    Arclaw box;
    address[8] tok;
    uint256[8] px = [uint256(214_126_834), 353_103_556, 343_420_211, 250_191_028, 710_510_964, 339_170_233, 763_695_138, 710_162_951];

    function setUp() public {
        b = new Builder();
        box = new Arclaw("", address(new MockVRFCoordinator()), 0.1 ether);
        MockPriceSource ps = new MockPriceSource();
        address[] memory t = new address[](8);
        uint256[] memory p = new uint256[](8);
        for (uint256 i; i < 8; ++i) {
            tok[i] = address(new MockStock("X.arc"));
            (t[i], p[i]) = (tok[i], px[i]);
        }
        ps.setPrices(t, p);
        box.setPolicy(IPriceSource(address(ps)), 0);
    }

    function test_machinesJson_tablesSatisfyRules() public {
        ArcConfig.Policy memory pol = b.policy();
        ArcConfig.MachineCfg[] memory ms = b.machinesCfg();
        assertGt(ms.length, 0);
        for (uint256 i; i < ms.length; ++i) {
            _check(ms[i], pol);
        }
    }

    function _check(ArcConfig.MachineCfg memory m, ArcConfig.Policy memory pol) internal {
        box.setMachine(
            m.id, uint128(m.priceUsdc * 1e18), uint16(pol.floorBps), uint32(m.capBps), uint16(pol.rtpMinBps), uint16(pol.rtpMaxBps)
        );
        box.setPrizes(m.id, b.buildFor(m, tok, px));
        (uint256 rtp, uint256 minBps, uint256 maxBps,) = new ArclawLens().stats(box, m.id);
        console.log(m.name, "rtp bps", rtp);
        console.log("  min pack bps", minBps, "max pack bps", maxBps);
        assertGe(minBps, pol.floorBps);
        assertLe(maxBps, m.capBps);
        assertGe(rtp, pol.rtpMinBps);
        assertLe(rtp, pol.rtpMaxBps);
    }
}
