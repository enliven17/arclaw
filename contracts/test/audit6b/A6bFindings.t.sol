// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {ID20VRF} from "../../src/vrf/d20/interfaces/ID20VRF.sol";

/// audit6b: independent review of 268a1f7. L-01, L-02 and INFO-01 flipped in round 4 to assert the fixed behaviour.
contract A6bFindings is Base {
    uint256 constant M3 = 3; // the Vault machine as Deploy.s.sol configures it: 10 USDC, band 6000..8800
    uint256 constant P3 = 10 ether;
    uint256 constant T0 = 1_800_000_000; // Base.setUp warp; absolute warps (via_ir re-reads block.timestamp)

    function setUp() public override {
        super.setUp();
        // exactly what Deploy._configure does with lib/machines.json's single global policy
        box.setMachine(M3, uint128(P3), 5000, 100_000, 6000, 8800);
    }

    /// M-01: lib/machines.json has ONE rtp band (6000..8800) for every machine, so the advertised 85% Vault (and the
    /// 80% Stack) is only promised 60% on chain. The operator hot key alone reprices a machine to a 60% table; holders
    /// of sealed boxes bought at 85% cannot get out (refundSealed needs off / stale / paused) and rtpMin can only
    /// move up, so the "what a sold box was promised" lock protects 60%, not the advertised 85%.
    function test_m01_operatorCutsVaultRtpFrom85To60() public {
        Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](2);
        t[0] = _pack(address(nvda), 3, 0, P3 * 6 / 10); // 0.6x
        t[1] = _pack(address(nvda), 1, 1, P3 * 16 / 10); // 1.6x  -> EV 0.85x, the advertised Vault RTP
        box.setPrizes(M3, t);
        (uint256 rtp0,,,) = lens.stats(box, M3);
        assertApproxEqAbs(rtp0, 8500, 2);

        _play(alice, M3, 5); // 50 USDC of Vault boxes bought at 85%

        // operator (hot key, no owner involvement): 0.551x x9 + 1.05x x1 -> EV 0.6009x
        Arclaw.OutcomeInput[] memory cut = new Arclaw.OutcomeInput[](2);
        cut[0] = _pack(address(nvda), 9, 0, P3 * 551 / 1000);
        cut[1] = _pack(address(nvda), 1, 1, P3 * 105 / 100);
        vm.prank(op);
        box.operatorSetPrizes(M3, cut);
        (uint256 rtp1,,,) = lens.stats(box, M3);
        assertLt(rtp1, 6050, "Vault now returns ~60%, a 40% house edge");
        assertGe(rtp1, 6000);

        // alice cannot leave at the price she paid: the machine is on, the table fresh, nothing paused
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M3, 5);
        // the owner cannot even restore the advertised minimum for her without it applying from the next table only,
        // and the operator can keep re-cutting: rtpMin 6000 is the only promise
        (,,, uint16 rtpMin,) = box.machines(M3);
        assertEq(rtpMin, 6000);
    }

    /// L-01 fixed: the owner batch [setPrizes (fresh), unpause, pause, setMachineActive(true), setMachineActive(false)]
    /// no longer restarts refundSealed's clock: unpause and a switch back on keep the pause and off clocks until the
    /// contract / machine has been back in service a full day, so 3 days after the first pause the boxes refund.
    function test_fixed_l01_ownerBatchCannotResetSealedRefundClock() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 3);
        box.pause();
        box.setMachineActive(M1, false);

        vm.warp(T0 + 2 days + 23 hours);
        // one multisig batch: fresh table, clocks "cleared" and restarted in the same transaction
        box.setPrizes(M1, _table(address(nvda), P1));
        box.unpause();
        box.pause();
        box.setMachineActive(M1, true);
        box.setMachineActive(M1, false);
        assertEq(box.pausedSince(), T0, "pause clock kept");
        assertEq(box.sealedRefundAt(M1), T0 + 3 days);
        vm.warp(T0 + 2 days + 23 hours + 2 hours); // past 3 days since the pause and switch-off
        uint256 a0 = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 3);
        assertEq(alice.balance - a0, 3 * P1, "refunded on time");
    }

    /// L-01 fixed, machine clock alone (contract not paused): on+off in one batch keeps the off clock.
    function test_fixed_l01_machineOnOffBatchKeepsOffClock() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 1);
        box.setMachineActive(M1, false);
        vm.warp(T0 + 2 days);
        box.setPrizes(M1, _table(address(nvda), P1)); // table fresh: only the off clock runs
        box.setMachineActive(M1, true);
        box.setMachineActive(M1, false);
        assertEq(box.sealedRefundAt(M1), T0 + 3 days, "off clock kept");
        vm.warp(T0 + 3 days);
        vm.prank(alice);
        box.refundSealed(M1, 1);

        // a full day on resets it: the next switch-off starts a new clock
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setMachineActive(M1, true);
        _play(alice, M1, 1);
        vm.warp(T0 + 4 days);
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setMachineActive(M1, false);
        assertEq(box.sealedRefundAt(M1), T0 + 7 days, "new clock after a day of service");
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M1, 1);
    }

    /// L-02 fixed: a dead or paused VRF coordinator no longer traps sealed boxes behind fresh tables: the guardian
    /// (a hot key, pause only) or anyone with pauseIfVrfDown pauses, which starts the refundSealed clock.
    function test_fixed_l02_deadCoordinatorGuardianPausesAndBoxesRefund() public {
        address guard = makeAddr("guardian");
        box.setGuardian(guard);
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 2);
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(ID20VRF.requestRandomness.selector), "dead");
        vm.prank(guard);
        box.pause();
        for (uint256 d = 1; d <= 3; ++d) {
            vm.warp(T0 + d * 1 days - 1 hours);
            Arclaw.OutcomeInput[] memory fresh = _table(address(nvda), P1);
            vm.prank(op);
            box.operatorSetPrizes(M1, fresh); // reprice bot keeps running
            vm.prank(alice);
            vm.expectRevert(Arclaw.NotExpired.selector);
            box.refundSealed(M1, 2);
        }
        vm.warp(T0 + 3 days);
        uint256 a0 = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 2);
        assertEq(alice.balance - a0, 2 * P1);
        // the guardian cannot undo it
        vm.prank(guard);
        vm.expectRevert();
        box.unpause();
    }

    /// INFO-01 fixed: the top-up D20 refunds early lands in topUpReserve, not the free balance: the owner's withdraw
    /// leaves it, returnBoxes pays it back in cash and the reserves stay backed.
    function test_fixed_info01_topUpReservedUntilRepaid() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        vrf.setFee(0.3 ether); // subsidy 0.1, alice tops up 0.2
        _play(alice, M1, 1);
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        (uint256 id, uint256 req) = box.open{value: 0.2 ether}(M1, 1, tid);
        assertEq(box.openingTopUp(id), 0.2 ether);
        assertEq(box.topUpReserve(), 0.2 ether);

        vm.warp(T0 + 61);
        vrf.refundRequest(req); // anyone; 0.3 lands
        box.withdraw(address(this), box.freeBalance()); // owner takes the free balance, alice's 0.2 is not in it

        vm.warp(T0 + 1 days + 62); // table aged out: returnBoxes allowed
        uint256 a0 = alice.balance;
        vm.prank(alice);
        box.returnBoxes(id);
        uint256 reserves = box.reservedCredit() + box.pendingReserve() + box.sealedReserve() + box.totalOwed();
        assertEq(alice.balance - a0, 0.2 ether, "top-up paid back");
        assertEq(box.credit(alice), 0);
        assertGe(address(box).balance, reserves, "reserves backed");
    }

    receive() external payable {}
}
