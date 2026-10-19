// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MockVRFCoordinator} from "../../src/mocks/MockVRFCoordinator.sol";
import {ID20Coordinator} from "../../src/vrf/D20Randomness.sol";

/// audit6a: round-3 fixes (pausedSince, 7-day lost return, PUSH_GAS, _payTopUp credit, RTP retune). Findings L-01 to
/// L-03 flipped in round 4 to assert the fixed behaviour (scenarios kept).
/// Absolute warps from T0 (via-IR may re-read block.timestamp after vm.warp).
contract A6aFindings is Base {
    address sink = makeAddr("sink");
    address anyone = makeAddr("anyone");
    uint256 constant T0 = 1_800_000_000;

    receive() external payable {}

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setPrizes(M2, _table(address(nvda), P2));
    }

    function _req(uint256 openingId) internal view returns (uint256 r) {
        (,,,,,, r,) = box.openings(openingId);
    }

    function _liabilities() internal view returns (uint256) {
        return box.reservedCredit() + box.pendingReserve() + box.sealedReserve();
    }

    // ------------------------------------------------------------------ L-01

    /// L-01 fixed: the opener's top-up is reserved (topUpReserve) from the open until it is revealed or paid back,
    /// so an early permissionless D20 refundRequest lands as reserved, not free, balance: the owner's routine
    /// withdraw(freeBalance) leaves it, returnBoxes pays it back in cash and no credit is minted out of nothing.
    function test_fixed_l01_topUpReservedAfterEarlyD20Refund() public {
        vm.deal(address(box), 1 ether); // house float covers the subsidy
        vrf.setFee(0.15 ether); // subsidy 0.1 => alice tops up 0.05
        _play(alice, M1, 1);
        _play(bob, M1, 1); // bob's sealed box was the victim reserve
        uint256 tableId = box.currentTable(M1) - 1;
        vm.prank(alice);
        (uint256 id, uint256 req) = box.open{value: 0.05 ether}(M1, 1, tableId);
        assertEq(box.topUpReserve(), 0.05 ether);

        vm.warp(T0 + 61);
        vm.prank(anyone);
        vrf.refundRequest(req); // permissionless on D20: 0.15 lands
        box.withdraw(sink, box.freeBalance()); // owner sweeps the free balance: the top-up is not in it
        assertGe(address(box).balance, _liabilities() + box.topUpReserve(), "top-up still held");

        vm.warp(T0 + 1 days + 61); // table aged out
        uint256 a0 = alice.balance;
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(alice.balance - a0, 0.05 ether, "top-up paid back in cash");
        assertEq(box.credit(alice), 0, "no credit");
        assertEq(box.topUpReserve(), 0);
        assertGe(address(box).balance, _liabilities(), "liabilities backed");

        // both sealed refunds are paid in full, in cash
        vm.warp(T0 + 10 days);
        box.setMachineActive(M1, false);
        vm.warp(T0 + 14 days);
        vm.prank(alice);
        box.refundSealed(M1, 1);
        uint256 b0 = bob.balance;
        vm.prank(bob);
        box.refundSealed(M1, 1);
        assertEq(bob.balance - b0, P1, "bob paid in cash");
        assertEq(box.credit(bob), 0);
    }

    /// L-01 dead-coordinator variant fixed: D20 never refunds, but the top-up was reserved out of the house float at
    /// open, so the 7-day lost path pays it back in cash, backed.
    function test_fixed_l01_topUpBackedWhenCoordinatorDead() public {
        vm.deal(address(box), 1 ether);
        vrf.setFee(0.15 ether);
        _play(alice, M1, 1);
        uint256 tableId = box.currentTable(M1) - 1;
        vm.prank(alice);
        (uint256 id,) = box.open{value: 0.05 ether}(M1, 1, tableId);
        box.withdraw(sink, box.freeBalance());

        vm.warp(T0 + 8 days);
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(MockVRFCoordinator.getRequest.selector), "dead");
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(MockVRFCoordinator.refundRequest.selector), "dead");
        uint256 a0 = alice.balance;
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(alice.balance - a0, 0.05 ether, "paid from the reserve");
        assertEq(box.credit(alice), 0);
        assertGe(address(box).balance, _liabilities(), "liabilities backed");
    }

    /// L-01: with no house float at all (the subsidy came out of reserves, A3a INFO) and D20 dead, the reserve
    /// cannot be met: the shortfall is an IOU (owed, last in line, pauses), never unbacked credit.
    function test_fixed_l01_shortTopUpBecomesIouNotCredit() public {
        vrf.setFee(0.15 ether);
        _play(alice, M1, 1);
        uint256 tableId = box.currentTable(M1) - 1;
        vm.prank(alice);
        (uint256 id,) = box.open{value: 0.05 ether}(M1, 1, tableId);
        // the house float is gone meanwhile (spent elsewhere): only the box price is left, the top-up is unbacked
        vm.deal(address(box), 1 ether);
        vm.warp(T0 + 8 days);
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(MockVRFCoordinator.getRequest.selector), "dead");
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(MockVRFCoordinator.refundRequest.selector), "dead");
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.credit(alice), 0, "no credit without backing");
        assertEq(box.owed(alice), 0.05 ether, "IOU instead");
        assertTrue(box.paused(), "an IOU pauses");
        assertEq(box.reservedCredit(), 0);
    }

    // ------------------------------------------------------------------ L-02

    /// L-02 fixed: when the coordinator's request path is dead, anyone proves it on chain with pauseIfVrfDown: the
    /// contract pauses (no more plays of boxes nobody can open) and the refundSealed clock starts, whatever the
    /// repricing bot does.
    function test_fixed_l02_deadVrfAnyonePausesAndSealedRefunds() public {
        _play(alice, M1, 1);
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(MockVRFCoordinator.requestRandomness.selector), "dead");
        uint256 tableId = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert();
        box.open{value: 0}(M1, 1, tableId);

        vm.prank(anyone);
        box.pauseIfVrfDown{gas: 2_000_000}();
        assertTrue(box.paused());
        assertEq(box.pausedSince(), T0);
        assertEq(box.sealedRefundAt(M1), T0 + 3 days);

        Arclaw.OutcomeInput[] memory fresh = _table(address(nvda), P1);
        for (uint256 d = 1; d <= 2; ++d) {
            vm.warp(T0 + d * 1 days);
            vm.prank(op);
            box.operatorSetPrizes(M1, fresh);
            vm.prank(alice);
            vm.expectRevert(Arclaw.NotExpired.selector);
            box.refundSealed(M1, 1);
        }
        vm.warp(T0 + 3 days);
        uint256 a0 = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 1);
        assertEq(alice.balance - a0, P1);
        // no new boxes nobody can open
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        box.play{value: P1}(M1, 1);
    }

    // ------------------------------------------------------------------ L-03

    /// L-03 fixed: unpause + pause in one batch keeps the running pause clock (it restarts only after a day back in
    /// service), so the owner cannot hold sealedReserve: 3 days after the first pause the boxes refund.
    function test_fixed_l03_ownerCannotResetPauseClockInOneBatch() public {
        _play(alice, M1, 1);
        box.pause();
        Arclaw.OutcomeInput[] memory fresh = _table(address(nvda), P1);
        for (uint256 d = 1; d <= 2; ++d) {
            vm.warp(T0 + d * 1 days);
            vm.prank(op);
            box.operatorSetPrizes(M1, fresh);
            box.unpause(); // same transaction in a multisig batch: nobody can open in between
            box.pause();
            assertEq(box.pausedSince(), T0, "clock kept");
            vm.prank(alice);
            vm.expectRevert(Arclaw.NotExpired.selector);
            box.refundSealed(M1, 1);
            uint256 tableId = box.currentTable(M1) - 1;
            vm.prank(alice);
            vm.expectRevert(Pausable.EnforcedPause.selector);
            box.open(M1, 1, tableId);
        }
        vm.warp(T0 + 3 days);
        vm.prank(op);
        box.operatorSetPrizes(M1, fresh);
        box.unpause();
        box.pause();
        uint256 a0 = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 1);
        assertEq(alice.balance - a0, P1, "refunded 3 days after the first pause");
    }

    /// L-03: the pause clock does restart after a full day of service, and stays valid through that day.
    function test_fixed_l03_pauseClockResetsAfterADayOfService() public {
        _play(alice, M1, 1);
        Arclaw.OutcomeInput[] memory fresh = _table(address(nvda), P1);
        box.pause();
        vm.warp(T0 + 4 days);
        vm.prank(op);
        box.operatorSetPrizes(M1, fresh);
        box.unpause();
        // back in service but under a day: the old clock still counts, holders may still leave at the price
        assertEq(box.sealedRefundAt(M1), T0 + 3 days);
        vm.warp(T0 + 5 days);
        vm.prank(op);
        box.operatorSetPrizes(M1, fresh);
        assertEq(box.sealedRefundAt(M1), T0 + 5 days + 1 days + 3 days, "a day of service: only the table clock");
        box.pause();
        assertEq(box.pausedSince(), T0 + 5 days, "a new pause starts a new clock");
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M1, 1);
    }

    // ------------------------------------------------------------------ INFO

    /// INFO-1: a fulfilled request whose callback failed leaves the opening Pending with a public word. 7 days on, a
    /// coordinator outage (getRequest reverting) makes it "lost": the opener who saw a bad word takes the boxes back
    /// instead. Needs the keeper to have skipped the reveal for a week plus a D20 outage; low likelihood.
    function test_info_flakyCoordinatorFreeOptionAfterSevenDays() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfillStarved(req, bytes32(uint256(1)));
        assertEq(uint256(_status(id)), uint256(Arclaw.OpeningStatus.Pending));

        vm.warp(T0 + 7 days + 1);
        vm.prank(alice);
        vm.expectRevert(Arclaw.AlreadyFulfilled.selector);
        box.returnBoxes(id); // coordinator healthy: no way out, reveal it

        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(MockVRFCoordinator.getRequest.selector), "down");
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.balanceOf(alice, M1), 1, "box back although the word was known");
    }

    /// SOUND: the opener cannot fake "lost" by starving the getRequest staticcall (63/64): whatever gas it gets,
    /// the 1/64 left cannot finish returnBoxes.
    function test_sound_gasStarvationCannotFakeLost() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfillStarved(req, bytes32(uint256(1)));
        vm.warp(T0 + 7 days + 1);
        for (uint256 g = 20_000; g < 400_000; g += 1_000) {
            vm.prank(alice);
            (bool ok,) = address(box).call{gas: g}(abi.encodeCall(Arclaw.returnBoxes, (id)));
            assertFalse(ok);
        }
        assertEq(uint256(_status(id)), uint256(Arclaw.OpeningStatus.Pending));
    }

    /// INFO-2: _randomnessLost reads word 4 (deadline) and word 12 (fulfilled) of the 17-word Request.
    function test_sound_lostReadsRightWords() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        ID20Coordinator.Request memory r = vrf.getRequest(req);
        assertEq(r.deadline, T0 + 60);
        vm.warp(T0 + 7 days + 1);
        vrf.fulfillStarved(req, bytes32(uint256(7))); // late fulfilment in the mock: fulfilled=1 => not lost
        vm.prank(alice);
        vm.expectRevert(Arclaw.AlreadyFulfilled.selector);
        box.returnBoxes(id);
    }

    /// INFO-3: worst-case reveal gas: 20 boxes, every one of 60 cards bought just in time.
    function test_info_revealGasWorstCase() public {
        box.setJit(address(desk), 100, 60, type(uint128).max, 0);
        vm.deal(address(box), 1000 ether);
        _play(alice, M1, 20);
        (uint256 id, uint256 req) = _open(alice, M1, 20);
        vrf.fulfill(req, keccak256("w"));
        box.sweep(address(nvda), sink, nvda.balanceOf(address(box)));
        uint256 g0 = gasleft();
        box.reveal(id);
        uint256 used = g0 - gasleft();
        emit log_named_uint("reveal 20 boxes, 60 JIT buys, gas", used);
        assertEq(box.cardsPaid(), 60);
        assertLt(used, 15_000_000);
    }
}
