// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {MockStock} from "../../src/mocks/MockStock.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ArclawLens} from "../../src/ArclawLens.sol";
import {ArcConfig} from "../../script/Deploy.s.sol";
import {Builder} from "../MachinesJson.t.sol";
import {MockPriceSource} from "../../src/mocks/MockPriceSource.sol";
import {MockVRFCoordinator} from "../../src/mocks/MockVRFCoordinator.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";

/// Opener whose receive() burns every unit of gas it is given (only when it is pushed a refund).
contract GasBurner {
    Arclaw public immutable box;

    constructor(Arclaw b) payable {
        box = b;
    }

    function play(uint256 machineId, uint256 n, uint256 value) external {
        box.play{value: value}(machineId, n);
    }

    function open(uint256 machineId, uint256 n, uint256 tableId) external returns (uint256 id, uint256 req) {
        return box.open(machineId, n, tableId);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    receive() external payable {
        while (true) {}
    }
}

contract A5aFindings is Base {
    address sink = makeAddr("sink");
    /// Base.setUp warps here. Warps are absolute: under via-IR a block.timestamp read can be re-evaluated after
    /// vm.warp, so neither `warp(block.timestamp + x)` loops nor a local copy of block.timestamp are reliable.
    uint256 constant T0 = 1_800_000_000;

    receive() external payable {}

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setPrizes(M2, _table(address(nvda), P2));
    }

    /// A word whose box 0 draws outcome 1 (the 1.5x pack) of the 3:1 test table.
    function _bigWord() internal pure returns (bytes32 w) {
        for (uint256 i;; ++i) {
            w = bytes32(i);
            if (uint256(keccak256(abi.encode(w, uint256(0)))) % 4 == 3) return w;
        }
    }

    function _req(uint256 openingId) internal view returns (uint256 r) {
        (,,,,,, r,) = box.openings(openingId);
    }

    // ------------------------------------------------------------------ M-01

    /// M-01 fixed: a pause starts refundSealed's clock like a machine switch-off or a stale table, and the earliest
    /// running clock counts: the owner toggling the machine off and on (or the operator repricing daily) during the
    /// pause cannot restart it. Absolute warps from T0 (see there).
    function test_fixed_m01_pauseStartsSealedRefundClock() public {
        _play(alice, M1, 2);
        box.pause();
        Arclaw.OutcomeInput[] memory fresh = _table(address(nvda), P1);
        for (uint256 d = 1; d <= 2; ++d) {
            vm.warp(T0 + d * 1 days);
            vm.prank(op);
            box.operatorSetPrizes(M1, fresh);
        }
        box.setMachineActive(M1, false); // owner toggles the machine: off clock starts now, on clears it
        box.setMachineActive(M1, true);
        box.setMachineActive(M1, false);
        uint256 tableId = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        box.open(M1, 1, tableId);

        vm.warp(T0 + 3 days - 1);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M1, 2);

        vm.warp(T0 + 3 days); // 3 days after the pause, whatever the toggles and reprices did
        uint256 before = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 1);
        assertEq(alice.balance - before, P1);

        // the automatic pause after an IOU starts the clock too; unpause clears it
        box.unpause();
        assertEq(box.pausedSince(), 0);
    }

    // ------------------------------------------------------------------ L-01

    /// L-01 fixed: an expired request's VRF top-up is paid from the unreserved balance, and what that cannot cover
    /// while an IOU is outstanding becomes the opener's credit (reserved): never dropped. The automatic pause after
    /// the IOU also starts the sealed-refund clock.
    function test_fixed_l01_topUpCreditedWhileIousOutstanding() public {
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(box).call{value: 1 ether}(""); // house treasury covers the subsidies
        assertTrue(ok);
        vrf.setFee(0.15 ether); // subsidy 0.1 => top-up 0.05

        _play(alice, M1, 1);
        _play(bob, M2, 1);
        uint256 t1 = box.currentTable(M1) - 1;
        uint256 t2 = box.currentTable(M2) - 1;
        vm.prank(alice);
        (uint256 aId,) = box.open{value: 0.05 ether}(M1, 1, t1);
        assertEq(box.openingTopUp(aId), 0.05 ether);
        vm.prank(bob);
        (uint256 bId,) = box.open{value: 0.05 ether}(M2, 1, t2);

        // bob's big pack, stock not on hand, free balance out: bob gets an IOU and the contract pauses
        vrf.fulfill(_req(bId), _bigWord());
        box.sweep(address(nvda), sink, nvda.balanceOf(address(box)));
        box.withdraw(sink, box.freeBalance());
        vm.prank(bob);
        box.reveal(bId);
        assertGt(box.totalOwed(), 0);
        assertTrue(box.paused());
        assertEq(box.pausedSince(), T0, "auto-pause starts the sealed-refund clock");

        // alice's request never landed; once the table ages out she takes her box back
        vm.warp(T0 + 1 days + 61);
        uint256 before = alice.balance;
        vm.prank(alice);
        box.returnBoxes(aId);
        assertEq(box.balanceOf(alice, M1), 1);
        assertEq(alice.balance - before + box.credit(alice), 0.05 ether, "top-up paid or credited");
        assertGt(box.credit(alice), 0, "credited ahead of the IOUs");
        assertEq(box.owed(alice), 0);
        assertEq(box.openingTopUp(aId), 0);
        vm.prank(alice);
        box.claimCredit();
        assertEq(alice.balance - before, 0.05 ether, "claimable");
    }

    // ------------------------------------------------------------------ INFO

    /// INFO-1: an expired opening whose prices left the band (or whose floor broke at live prices) can neither retry
    /// nor return until its table ages out: up to maxTableAge (<= 1 day) of the player's box price locked. Bounded.
    function test_info_expiredOpeningWaitsForTableAge() public {
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(block.timestamp + 61);
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        (t[0], p[0]) = (address(nvda), 212e6); // +6%
        prices.setPrices(t, p);

        vm.expectRevert(Arclaw.TableStale.selector);
        box.retry(id);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.returnBoxes(id);

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.balanceOf(alice, M1), 1);
    }

    /// INFO-2 fixed: pushes forward PUSH_GAS (100k). A gas-burning opener costs the keeper about that, not the whole
    /// gas limit; the refund still settles as credit.
    function test_fixed_info_gasBurnerCannotTaxKeeper() public {
        GasBurner g = new GasBurner{value: 10 ether}(box);
        g.play(M1, 1, P1);
        uint256 tableId = box.currentTable(M1) - 1;
        (uint256 id, uint256 req) = g.open(M1, 1, tableId);
        vrf.fulfill(req, bytes32(0));
        box.sweep(address(nvda), sink, nvda.balanceOf(address(box))); // every card refunds => a push
        uint256 g0 = gasleft();
        box.reveal{gas: 5_000_000}(id);
        uint256 used = g0 - gasleft();
        assertGt(box.credit(address(g)), 0, "settled as credit");
        assertLt(used, 1_000_000, "keeper pays about PUSH_GAS for the burner");
    }

    /// INFO-3 fixed: machines.json writes the floor tier as deployed (5265) and its weights are retuned, so the
    /// tables land at 75.0 / 80.0 / 85.0% realised RTP (max boost +0.16) inside the on-chain band. rtpMinBps stays
    /// 6000: floor and rtpMin only move up on chain, the realised targets are tested here and in MachinesJson.t.sol.
    function test_fixed_info_machinesJsonOnProductTargets() public {
        Builder b = new Builder();
        Arclaw x = new Arclaw("", address(new MockVRFCoordinator()), 0.1 ether);
        MockPriceSource ps = new MockPriceSource();
        address[8] memory tok;
        uint256[8] memory px = [uint256(180e6), 250e6, 230e6, 220e6, 700e6, 190e6, 650e6, 560e6];
        address[] memory t = new address[](8);
        uint256[] memory p = new uint256[](8);
        for (uint256 i; i < 8; ++i) {
            tok[i] = address(new MockStock("X.arc"));
            (t[i], p[i]) = (tok[i], px[i]);
        }
        ps.setPrices(t, p);
        x.setPolicy(IPriceSource(address(ps)), 0);
        ArcConfig.Policy memory pol = b.policy();
        ArcConfig.MachineCfg[] memory ms = b.machinesCfg();
        ArclawLens l = new ArclawLens();
        uint256[3] memory target = [uint256(7500), 8000, 8500];
        for (uint256 i; i < 3; ++i) {
            ArcConfig.MachineCfg memory m = ms[i];
            x.setMachine(
                m.id, uint128(m.priceUsdc * 1e18), uint16(pol.floorBps), uint32(m.capBps), uint16(pol.rtpMinBps),
                uint16(pol.rtpMaxBps)
            );
            x.setPrizes(m.id, b.buildFor(m, tok, px));
            (uint256 rtp, uint256 minBps,,) = l.stats(x, m.id);
            assertApproxEqAbs(rtp, target[i], 10, "realised RTP on the product target");
            assertLe(l.luckyRtp(x, m.id), target[i] + 20, "max boost adds under 0.2 point");
            assertEq(minBps, 5265, "floor tier as written in machines.json");
        }
    }

    /// INFO-4: Arclaw's runtime stays under EIP-170 after round 3 (optimizer_runs 50: 24,454 bytes).
    function test_fixed_info_codeSizeUnderLimit() public view {
        assertLt(address(box).code.length, 24_576);
    }
}
