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
        view
        returns (Arclaw.OutcomeInput[] memory)
    {
        return buildTable(m, readPolicy(vm.readFile(MACHINES)).floorBps, tok, px);
    }

    /// The deploy script's pre-broadcast check of a machine's rules (reverts on a bad band).
    function check(MachineCfg memory m) external view {
        checkRules(m, readPolicy(vm.readFile(MACHINES)).floorBps);
    }

    /// The floor tier as deployed (floor x 1.053, see FLOOR_MARGIN_BPS).
    function liftedFloor(uint256 floorBps) external pure returns (uint256) {
        return floorBps * (10_000 + FLOOR_MARGIN_BPS) / 10_000;
    }
}

/// Builds every machine in ../lib/machines.json with the deploy script's code and lands it under the on-chain rules.
/// Prints realised RTP, smallest and largest pack. Prices are awkward on purpose (rounding must not break the floor).
/// Each machine carries its own RTP band (audit 6b M-01): rtpMin is the lock a sold box keeps, so it sits about one
/// point under the advertised return, not at a global 60%.
contract MachinesJsonTest is Test {
    Builder b;
    Arclaw box;
    MockPriceSource ps;
    ArclawLens lens;
    address op = makeAddr("operator");
    address[8] tok;
    uint256[8] px = [uint256(214_126_834), 353_103_556, 343_420_211, 250_191_028, 710_510_964, 339_170_233, 763_695_138, 710_162_951];

    /// Arclaw.maxPriceMoveBps default: the open-time guard band.
    uint256 constant GUARD_BPS = 500;
    /// Advertised band half-width: rtpMin and rtpMax within this of the product target.
    uint256 constant BAND_BPS = 100;

    function setUp() public {
        b = new Builder();
        lens = new ArclawLens();
        box = new Arclaw("", address(new MockVRFCoordinator()), 0.1 ether);
        ps = new MockPriceSource();
        for (uint256 i; i < 8; ++i) {
            tok[i] = address(new MockStock("X.arc"));
        }
        _setPrices(px);
        box.setPolicy(IPriceSource(address(ps)), 0);
        box.setOperator(op);
    }

    // ------------------------------------------------------------------ deploy tables

    function test_machinesJson_tablesSatisfyRules() public {
        ArcConfig.Policy memory pol = b.policy();
        ArcConfig.MachineCfg[] memory ms = b.machinesCfg();
        assertEq(ms.length, 3);
        for (uint256 i; i < ms.length; ++i) {
            _deploy(ms[i], pol);
            _check(ms[i], pol);
        }
    }

    function _check(ArcConfig.MachineCfg memory m, ArcConfig.Policy memory pol) internal view {
        (uint256 rtp, uint256 minBps, uint256 maxBps,) = lens.stats(box, m.id);
        uint256 lucky = lens.luckyRtp(box, m.id);
        console.log(m.name, "rtp bps", rtp, lucky);
        console.log("  band", m.rtpMinBps, m.rtpMaxBps);
        console.log("  min pack bps", minBps, "max pack bps", maxBps);
        assertGe(minBps, pol.floorBps);
        assertLe(maxBps, m.capBps);
        // realised and max-boost RTP inside the machine's own band
        assertGe(rtp, m.rtpMinBps, "realised RTP over rtpMin");
        assertLe(rtp, m.rtpMaxBps, "realised RTP under rtpMax");
        assertGe(lucky, m.rtpMinBps, "max-boost RTP over rtpMin");
        assertLe(lucky, m.rtpMaxBps, "max-boost RTP under rtpMax");
        // the product: 75 / 80 / 85% RTP (15 to 25% house edge), realised on chain within 0.1 point
        uint256 target = _target(m.id);
        assertApproxEqAbs(rtp, target, 10, "realised RTP on the product target");
        // the band hugs the advertised return: the lock (rtpMin) is at most 1 point under it
        assertGe(m.rtpMinBps + BAND_BPS, target, "rtpMin within 1 point of the target");
        assertLe(m.rtpMinBps, target, "rtpMin not above the target");
        assertLe(m.rtpMaxBps, target + BAND_BPS, "rtpMax within 1 point of the target");
        // setMachine's bounds: floor <= rtpMin <= rtpMax <= cap, rtpMax x 1.05 <= MAX_RTP_BPS
        assertLe(pol.floorBps, m.rtpMinBps);
        assertLe(m.rtpMaxBps, m.capBps);
        assertLe(m.rtpMaxBps * (10_000 + GUARD_BPS), 9500 * 10_000);
        b.check(m);
        // machines.json states what is deployed: no tier is lifted at build time, only the cap tier trimmed 1%
        uint256 lifted = b.liftedFloor(pol.floorBps);
        assertEq(m.tiers[0].multiplierBps, lifted, "floor tier written at floor x 1.053");
        for (uint256 k; k < m.tiers.length; ++k) {
            assertGe(m.tiers[k].multiplierBps, lifted, "no tier under the lifted floor");
        }
    }

    /// The machines land with their own band on chain, not a shared 60 to 88%.
    function test_machinesJson_bandOnChainPerMachine() public {
        ArcConfig.Policy memory pol = b.policy();
        ArcConfig.MachineCfg[] memory ms = b.machinesCfg();
        for (uint256 i; i < ms.length; ++i) {
            _deploy(ms[i], pol);
            (,,, uint16 rtpMin, uint16 rtpMax) = box.machines(ms[i].id);
            assertEq(rtpMin, ms[i].rtpMinBps);
            assertEq(rtpMax, ms[i].rtpMaxBps);
        }
        assertEq(ms[0].rtpMinBps, 7400);
        assertEq(ms[1].rtpMinBps, 7900);
        assertEq(ms[2].rtpMinBps, 8400);
    }

    // ------------------------------------------------------------------ repricing headroom

    /// Every stock moved to the edge of the 5% guard band (all up, all down, alternating): the operator's fresh
    /// reprice, built by the deploy script's code at the new prices, still lands inside each machine's band.
    function test_machinesJson_freshRepriceAtGuardEdgesLands() public {
        ArcConfig.Policy memory pol = b.policy();
        ArcConfig.MachineCfg[] memory ms = b.machinesCfg();
        for (uint256 i; i < ms.length; ++i) {
            _deploy(ms[i], pol);
        }
        int256[3] memory modes = [int256(1), -1, 0];
        for (uint256 r; r < modes.length; ++r) {
            uint256[8] memory moved;
            for (uint256 s; s < 8; ++s) {
                bool up = modes[r] == 1 || (modes[r] == 0 && s % 2 == 0);
                moved[s] = up ? px[s] * (10_000 + GUARD_BPS) / 10_000 : px[s] * (10_000 - GUARD_BPS) / 10_000;
            }
            _repriceAll(ms, pol, moved);
        }
    }

    /// Any per-stock move inside the guard band: a fresh reprice is accepted by operatorSetPrizes on every machine.
    function testFuzz_machinesJson_freshRepriceInsideGuardLands(uint256 seed) public {
        ArcConfig.Policy memory pol = b.policy();
        ArcConfig.MachineCfg[] memory ms = b.machinesCfg();
        for (uint256 i; i < ms.length; ++i) {
            _deploy(ms[i], pol);
        }
        uint256[8] memory moved;
        for (uint256 s; s < 8; ++s) {
            uint256 bps = uint256(keccak256(abi.encode(seed, s))) % (2 * GUARD_BPS + 1); // 0..1000 -> -5%..+5%
            moved[s] = px[s] * (10_000 - GUARD_BPS + bps) / 10_000;
        }
        _repriceAll(ms, pol, moved);
    }

    /// Quote to inclusion: a table built at one price lands after a 0.5% move of every stock either way (the band
    /// leaves ~1 point on each side). A 2% move breaks it and the reprice reverts: the operator re-quotes. Harmless,
    /// the current table keeps serving inside the guard.
    function test_machinesJson_quoteToInclusionSlippage() public {
        ArcConfig.Policy memory pol = b.policy();
        ArcConfig.MachineCfg[] memory ms = b.machinesCfg();
        for (uint256 i; i < ms.length; ++i) {
            _deploy(ms[i], pol);
            Arclaw.OutcomeInput[] memory table = b.buildFor(ms[i], tok, px);

            _setPrices(_scaled(9950));
            vm.prank(op);
            box.operatorSetPrizes(ms[i].id, table);
            _setPrices(_scaled(10_050));
            vm.prank(op);
            box.operatorSetPrizes(ms[i].id, table);

            _setPrices(_scaled(9800));
            vm.prank(op);
            vm.expectRevert();
            box.operatorSetPrizes(ms[i].id, table);
            _setPrices(px);
        }
    }

    /// The M-01 repricing: the operator cuts a machine to ~60% by piling weight on the floor tier. With the per machine
    /// band the contract refuses it on every machine; the owner cannot lower rtpMin either.
    function test_machinesJson_operatorCannotCutUnderAdvertisedReturn() public {
        ArcConfig.Policy memory pol = b.policy();
        ArcConfig.MachineCfg[] memory ms = b.machinesCfg();
        for (uint256 i; i < ms.length; ++i) {
            ArcConfig.MachineCfg memory m = ms[i];
            _deploy(m, pol);
            Arclaw.OutcomeInput[] memory cut = b.buildFor(m, tok, px);
            cut[0].weight = cut[0].weight * 20; // Common 0.5265x dominates: EV well under the target
            vm.prank(op);
            vm.expectPartialRevert(Arclaw.RtpOutOfBand.selector);
            box.operatorSetPrizes(m.id, cut);

            vm.expectRevert(Arclaw.RuleLowered.selector);
            box.setMachine(
                m.id, uint128(m.priceUsdc * 1e18), uint16(pol.floorBps), uint32(m.capBps), 6000, uint16(m.rtpMaxBps)
            );
        }
    }

    // ------------------------------------------------------------------ helpers

    function _deploy(ArcConfig.MachineCfg memory m, ArcConfig.Policy memory pol) internal {
        box.setMachine(
            m.id, uint128(m.priceUsdc * 1e18), uint16(pol.floorBps), uint32(m.capBps), uint16(m.rtpMinBps), uint16(m.rtpMaxBps)
        );
        box.setPrizes(m.id, b.buildFor(m, tok, px));
    }

    function _repriceAll(ArcConfig.MachineCfg[] memory ms, ArcConfig.Policy memory pol, uint256[8] memory moved)
        internal
    {
        _setPrices(moved);
        for (uint256 i; i < ms.length; ++i) {
            ArcConfig.MachineCfg memory m = ms[i];
            Arclaw.OutcomeInput[] memory fresh = b.buildFor(m, tok, moved); // before the prank: an external call
            vm.prank(op);
            box.operatorSetPrizes(m.id, fresh);
            (uint256 rtp, uint256 minBps, uint256 maxBps,) = lens.stats(box, m.id);
            uint256 lucky = lens.luckyRtp(box, m.id);
            assertGe(rtp, m.rtpMinBps);
            assertLe(lucky, m.rtpMaxBps);
            assertApproxEqAbs(rtp, _target(m.id), 10);
            assertGe(minBps, pol.floorBps);
            assertLe(maxBps, m.capBps);
        }
        _setPrices(px);
    }

    function _scaled(uint256 bps) internal view returns (uint256[8] memory p) {
        for (uint256 s; s < 8; ++s) {
            p[s] = px[s] * bps / 10_000;
        }
    }

    function _setPrices(uint256[8] memory p8) internal {
        address[] memory t = new address[](8);
        uint256[] memory p = new uint256[](8);
        for (uint256 s; s < 8; ++s) {
            (t[s], p[s]) = (tok[s], p8[s]);
        }
        ps.setPrices(t, p);
    }

    function _target(uint256 id) internal pure returns (uint256) {
        return id == 1 ? 7500 : id == 2 ? 8000 : 8500;
    }
}
