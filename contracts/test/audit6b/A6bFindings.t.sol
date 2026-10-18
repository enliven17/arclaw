// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {ID20VRF} from "../../src/vrf/d20/interfaces/ID20VRF.sol";

/// audit6b: independent review of 268a1f7.
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

    /// L-01: refundSealed's clock (pause / off / stale) is meant to be unresettable, but `unpause` and
    /// `setMachineActive(true)` clear it. An owner batch [setPrizes (fresh), unpause, pause] or
    /// [setPrizes, setMachineActive(true), setMachineActive(false)] every < 3 days restarts it with no window in which
    /// anyone can open: sealed boxes stay locked for good. With a swapped price source (junk table) this turns into a
    /// "open into junk or wait forever" squeeze on every holder.
    function test_l01_ownerBatchResetsSealedRefundClock() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 3);
        box.pause();
        box.setMachineActive(M1, false);

        for (uint256 i = 1; i <= 4; ++i) {
            vm.warp(T0 + i * (2 days + 23 hours));
            // one multisig batch: fresh table, clocks cleared and restarted in the same transaction
            box.setPrizes(M1, _table(address(nvda), P1));
            box.unpause();
            box.pause();
            box.setMachineActive(M1, true);
            box.setMachineActive(M1, false);
            vm.warp(T0 + i * (2 days + 23 hours) + 2 hours); // past 3 days since the previous pause and switch-off
            vm.prank(alice);
            vm.expectRevert(Arclaw.NotExpired.selector);
            box.refundSealed(M1, 3);
        }
        // last check at T0 + 4 x 71 h + 2 h = T0 + 286 h: ~12 days locked, off and paused the whole time
        assertEq(box.balanceOf(alice, M1), 3);
    }

    /// L-02: a dead or paused VRF coordinator stops every open, but sealed boxes keep no exit while the operator's
    /// bot keeps repricing (fresh table) and the owner has not paused or switched the machine off: refundSealed has no
    /// clock for "cannot be opened".
    function test_l02_deadCoordinatorTrapsSealedBoxesWhileTablesStayFresh() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 2);
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(ID20VRF.requestRandomness.selector), "dead");
        for (uint256 d = 1; d <= 10; ++d) {
            vm.warp(T0 + d * 1 days - 1 hours);
            Arclaw.OutcomeInput[] memory fresh = _table(address(nvda), P1);
            vm.prank(op);
            box.operatorSetPrizes(M1, fresh); // reprice bot keeps running
            uint256 tid = box.currentTable(M1) - 1;
            vm.prank(alice);
            vm.expectRevert();
            box.open(M1, 1, tid);
            vm.prank(alice);
            vm.expectRevert(Arclaw.NotExpired.selector);
            box.refundSealed(M1, 2);
        }
    }

    /// INFO-01: an expired request's fee comes back as FREE balance (anyone may call D20 refundRequest), while the
    /// opener's top-up it contains is owed but not reserved. Refund the fee early, withdraw the free balance, then
    /// returnBoxes credits the top-up with nothing behind it: reserves go under water by the top-up.
    function test_info01_topUpRefundIsFreeBalanceUntilRepaid() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        vrf.setFee(0.3 ether); // subsidy 0.1, alice tops up 0.2
        _play(alice, M1, 1);
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        (uint256 id, uint256 req) = box.open{value: 0.2 ether}(M1, 1, tid);
        assertEq(box.openingTopUp(id), 0.2 ether);

        vm.warp(block.timestamp + 61);
        vrf.refundRequest(req); // anyone; 0.3 lands as unreserved
        box.withdraw(address(this), box.freeBalance()); // owner takes it, alice's 0.2 included

        vm.warp(block.timestamp + 1 days + 1); // table aged out: returnBoxes allowed
        vm.prank(alice);
        box.returnBoxes(id);
        uint256 reserves = box.reservedCredit() + box.pendingReserve() + box.sealedReserve() + box.totalOwed();
        assertEq(box.credit(alice), 0.2 ether, "top-up became credit");
        assertEq(reserves - address(box).balance, 0.2 ether, "reserves under water by the top-up");
    }

    receive() external payable {}
}
