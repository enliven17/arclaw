// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MockVRFCoordinator} from "../../src/mocks/MockVRFCoordinator.sol";
import {ID20Coordinator} from "../../src/vrf/D20Randomness.sol";

/// audit6a: round-3 fixes (pausedSince, 7-day lost return, PUSH_GAS, _payTopUp credit, RTP retune).
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

    /// L-01: _payTopUp credits the part of a top-up the unreserved balance cannot cover. That is only backed when the
    /// D20 refund landed in the same call. If it landed earlier (anyone may call coordinator.refundRequest) it was
    /// unreserved, the owner's routine withdraw(freeBalance) took it, and returnBoxes then mints credit out of
    /// nothing: balance < credit + pending + sealed, the last sealed refund / credit claim is short.
    function test_l01_topUpCreditUnbackedAfterEarlyD20Refund() public {
        vm.deal(address(box), 1 ether); // house float covers the subsidy
        vrf.setFee(0.15 ether); // subsidy 0.1 => alice tops up 0.05
        _play(alice, M1, 1);
        _play(bob, M1, 1); // bob's sealed box is the victim reserve
        uint256 tableId = box.currentTable(M1) - 1;
        vm.prank(alice);
        (uint256 id, uint256 req) = box.open{value: 0.05 ether}(M1, 1, tableId);

        vm.warp(T0 + 61);
        vm.prank(anyone);
        vrf.refundRequest(req); // permissionless on D20: 0.15 lands as unreserved balance
        box.withdraw(sink, box.freeBalance()); // owner sweeps the free balance, top-up included
        assertGe(address(box).balance, _liabilities(), "backed before");

        vm.warp(T0 + 1 days + 61); // table aged out
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.credit(alice), 0.05 ether, "full top-up credited");
        assertLt(address(box).balance, _liabilities(), "credit is not backed by native");

        // alice claims first; bob's sealed refund is now short by the top-up
        vm.prank(alice);
        box.claimCredit();
        vm.warp(T0 + 10 days);
        box.setMachineActive(M1, false);
        vm.warp(T0 + 14 days);
        vm.prank(alice);
        box.refundSealed(M1, 1);
        vm.prank(bob);
        box.refundSealed(M1, 1); // push fails for lack of balance => credit, not cash
        assertGt(box.credit(bob), 0, "bob only gets an IOU-like credit");
        vm.prank(bob);
        vm.expectRevert(Arclaw.TransferFailed.selector);
        box.claimCredit();
    }

    /// L-01 dead-coordinator variant: the 7-day lost path never gets D20's refund back, so with no free balance the
    /// whole top-up is credited unbacked.
    function test_l01_topUpCreditUnbackedWhenCoordinatorDead() public {
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
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.credit(alice), 0.05 ether);
        assertLt(address(box).balance, _liabilities(), "credit is not backed by native");
    }

    // ------------------------------------------------------------------ L-02

    /// L-02: refundSealed has no clock for "opens fail for another reason". A dead or paused D20 (request reverts)
    /// with the machine on, the contract unpaused and the operator bot repricing daily (table fresh) leaves sealed
    /// boxes unopenable and unrefundable for as long as that lasts; the vrfCoordinator is immutable, so only the
    /// owner pausing or switching the machine off starts an exit.
    function test_l02_deadVrfTrapsSealedBoxesWhileTableFresh() public {
        _play(alice, M1, 1);
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(MockVRFCoordinator.requestRandomness.selector), "dead");
        Arclaw.OutcomeInput[] memory fresh = _table(address(nvda), P1);
        for (uint256 d = 1; d <= 10; ++d) {
            vm.warp(T0 + d * 1 days);
            vm.prank(op);
            box.operatorSetPrizes(M1, fresh);
            uint256 tableId = box.currentTable(M1) - 1;
            vm.prank(alice);
            vm.expectRevert();
            box.open{value: 0}(M1, 1, tableId);
            vm.prank(alice);
            vm.expectRevert(Arclaw.NotExpired.selector);
            box.refundSealed(M1, 1);
        }
        // play stays open meanwhile: new players keep buying boxes nobody can open
        _play(bob, M1, 1);
    }

    // ------------------------------------------------------------------ L-03

    /// L-03 (owner trust): every refundSealed clock can be restarted by the owner. unpause+pause in one batch resets
    /// pausedSince without opening a single block for opens; on+off resets offSince; the operator repricing keeps
    /// the stale clock from starting. A hostile or captured owner can lock sealedReserve indefinitely.
    function test_l03_ownerResetsPauseClockInOneBatch() public {
        _play(alice, M1, 1);
        box.pause();
        Arclaw.OutcomeInput[] memory fresh = _table(address(nvda), P1);
        for (uint256 d = 1; d <= 9; ++d) {
            vm.warp(T0 + d * 1 days);
            vm.prank(op);
            box.operatorSetPrizes(M1, fresh);
            if (d % 2 == 0) {
                box.unpause(); // same transaction in a multisig batch: nobody can open in between
                box.pause();
            }
            vm.prank(alice);
            vm.expectRevert(Arclaw.NotExpired.selector);
            box.refundSealed(M1, 1);
            uint256 tableId = box.currentTable(M1) - 1;
            vm.prank(alice);
            vm.expectRevert(Pausable.EnforcedPause.selector);
            box.open(M1, 1, tableId);
        }
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
