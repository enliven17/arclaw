// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {ID20Coordinator} from "../../src/vrf/D20Randomness.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// Opener contract whose receive burns every gas unit it gets, then reverts.
contract GasBurner {
    Arclaw immutable box;

    constructor(Arclaw b) {
        box = b;
    }

    function playOpen(uint256 m, uint256 price) external payable returns (uint256 id) {
        box.play{value: price}(m, 1);
        (id,) = box.open(m, 1, box.currentTable(m) - 1);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    receive() external payable {
        while (gasleft() > 3000) {}
        revert();
    }
}

/// Auditor 5b. Scenarios from 6f692fb, flipped to assert the fixed behaviour.
contract A5bFindingsTest is Base {
    /// Base.setUp warps here. Warps are absolute: under via-IR a block.timestamp read can be re-evaluated after
    /// vm.warp, so neither `warp(block.timestamp + x)` loops nor a local copy of block.timestamp are reliable.
    uint256 constant T0 = 1_800_000_000;
    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1)); // 0.5x (w3) / 1.5x (w1), EV 0.75x
    }

    function _wordFor(uint256 want) internal pure returns (bytes32 w) {
        for (uint256 i;; ++i) {
            w = keccak256(abi.encode("a5b", i));
            uint256 r = uint256(keccak256(abi.encode(w, uint256(0)))) % 4;
            if ((r < 3 ? 0 : 1) == want) return w;
        }
    }

    // ------------------------------------------------------------------ M-01

    /// M-01 fixed: a pause (owner, or the automatic one any IOU triggers in _settle) starts refundSealed's clock, so
    /// fresh tables from the repricing bot no longer keep sealed boxes locked.
    function test_fixed_m01_pauseOpensSealedRefund() public {
        _play(alice, M1, 3);
        box.pause(); // same state as the auto-pause after any IOU
        assertEq(box.pausedSince(), T0);
        for (uint256 d = 1; d <= 30; ++d) {
            vm.warp(T0 + d * 1 days - 1);
            Arclaw.OutcomeInput[] memory tb = _table(address(nvda), P1);
            vm.prank(op);
            box.operatorSetPrizes(M1, tb); // the repricing bot keeps running
            if (d == 2) {
                vm.prank(alice);
                vm.expectRevert(Arclaw.NotExpired.selector); // under 3 days paused
                box.refundSealed(M1, 3);
            }
        }
        uint256 t = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        box.open(M1, 1, t);
        uint256 before = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 3);
        assertEq(alice.balance - before, 3 * P1, "30 days on, the 3 USDC is back");
        assertEq(box.sealedReserve(), 0);

        box.unpause();
        assertEq(box.pausedSince(), 0, "unpause clears the clock");
    }

    // ------------------------------------------------------------------ M-02

    /// M-02 fixed: with the coordinator dead (every getRequest reverts), reveal, retry and rescue still need it, but
    /// RESCUE_AFTER the request returnBoxes treats the revert as expired and gives the opener the boxes back.
    function test_fixed_m02_deadCoordinatorReturnsBoxes() public {
        _play(alice, M1, 2);
        (uint256 id,) = _open(alice, M1, 2);
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(ID20Coordinator.getRequest.selector), "dead");

        vm.warp(T0 + 7 days); // not yet past RESCUE_AFTER: the status read still has to work
        vm.prank(alice);
        vm.expectRevert();
        box.returnBoxes(id);

        vm.warp(T0 + 60 days);
        vm.startPrank(alice);
        vm.expectRevert();
        box.reveal(id);
        vm.expectRevert();
        box.retry(id);
        vm.expectRevert(); // rescue reaches _reveal, which also reads the coordinator
        box.rescue(id);
        box.returnBoxes(id);
        vm.stopPrank();
        assertEq(box.pendingReserve(), 0, "nothing stranded");
        assertEq(box.sealedReserve(), 2 * P1, "sealed again");
        assertEq(box.balanceOf(alice, M1), 2);
    }

    /// Coordinator that answers but never marks the request expired (deadline 0): counts as lost after RESCUE_AFTER.
    function _unfulfilled() internal pure returns (ID20Coordinator.Request memory r) {}

    function test_fixed_m02_neverExpiringRequestReturnsBoxes() public {
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.mockCall(address(vrf), abi.encodeWithSelector(ID20Coordinator.getRequest.selector), abi.encode(_unfulfilled()));
        vm.warp(T0 + 60 days);
        vm.startPrank(alice);
        vm.expectRevert(Arclaw.NotReady.selector);
        box.reveal(id);
        box.returnBoxes(id);
        vm.stopPrank();
        assertEq(box.balanceOf(alice, M1), 1);
        assertEq(box.pendingReserve(), 0);
    }

    /// A fulfilled word is never thrown away by the RESCUE_AFTER path: the coordinator answers, so returnBoxes still
    /// refuses (AlreadyFulfilled) and the opening has to be revealed.
    function test_fixed_m02_fulfilledWordStillBlocksReturn() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfillStarved(req, _wordFor(0)); // fulfilled at the coordinator, our callback never ran
        vm.warp(T0 + 60 days);
        vm.prank(alice);
        vm.expectRevert(Arclaw.AlreadyFulfilled.selector);
        box.returnBoxes(id);
    }

    // ------------------------------------------------------------------ L-01

    /// L-01 fixed: pushes forward PUSH_GAS (100k). A gas-burning opener costs the keeper about that, the reveal
    /// settles with 2M gas, and the refund is parked as credit.
    function test_fixed_l01_gasBurnerCannotTaxKeeper() public {
        vm.deal(address(box), 10 ether); // float so the refund is paid, not owed
        box.sweep(address(nvda), address(this), nvda.balanceOf(address(box))); // cards short: refund leg runs
        GasBurner g = new GasBurner(box);
        uint256 id = g.playOpen{value: P1}(M1, P1);
        (,,,,,, uint256 req,) = box.openings(id);
        vrf.fulfill(req, _wordFor(0));

        uint256 g0 = gasleft();
        (bool ok,) = address(box).call{gas: 2_000_000}(abi.encodeCall(Arclaw.reveal, (id)));
        uint256 used = g0 - gasleft();
        assertTrue(ok, "keeper reveal with 2M gas settles");
        assertLt(used, 1_000_000, "the burner costs the keeper about PUSH_GAS");
        assertGt(box.credit(address(g)), 0, "refund parked as credit");
    }

    // ------------------------------------------------------------------ L-02

    /// L-02 fixed: with an IOU open, the part of an opener's VRF top-up the unreserved balance cannot pay becomes the
    /// opener's credit (reserved ahead of IOUs), never dropped; it can be claimed.
    function test_fixed_l02_topUpCreditedWhileAnIouIsOpen() public {
        address carol = makeAddr("carol");
        vm.deal(carol, 10 ether);
        box.sweep(address(nvda), address(this), nvda.balanceOf(address(box))); // reveals refund, so an IOU appears
        vrf.setFee(0.3 ether); // subsidy 0.1: each opener tops up 0.2

        _play(carol, M1, 1);
        uint256 t = box.currentTable(M1) - 1;
        vm.prank(carol);
        box.open{value: 0.2 ether}(M1, 1, t);
        uint256 carolId = box.nextOpeningId() - 1;

        _play(alice, M1, 1);
        vm.prank(alice);
        (uint256 aliceId, uint256 aliceReq) = box.open{value: 0.2 ether}(M1, 1, t);
        vrf.fulfill(aliceReq, _wordFor(1)); // the 1.5x pack, all short
        box.reveal(aliceId);
        assertGt(box.totalOwed(), 0, "alice holds an IOU");

        vm.warp(T0 + 1 days + 61); // carol's request expired, her table aged out
        uint256 before = carol.balance;
        vm.prank(carol);
        box.returnBoxes(carolId);
        assertEq(carol.balance - before + box.credit(carol), 0.2 ether, "carol's 0.2 top-up paid or credited");
        assertEq(box.openingTopUp(carolId), 0);
        assertGt(box.credit(carol), 0, "the IOU pool absorbed the refund: credited");
        vm.prank(carol);
        box.claimCredit();
        assertEq(carol.balance - before, 0.2 ether, "and claimable in full");
    }
}
