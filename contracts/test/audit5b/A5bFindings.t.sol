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

/// Auditor 5b. Every test shows the code as it stands at 6f692fb.
contract A5bFindingsTest is Base {
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

    /// M-01: refundSealed only opens on table age or the machine being off. A pause (owner, or the automatic one any
    /// IOU triggers in _settle) while the operator bot keeps repricing leaves sealed boxes with no exit at all.
    function test_m01_pauseWithFreshTablesTrapsSealedBoxes() public {
        _play(alice, M1, 3);
        box.pause(); // same state as the auto-pause after any IOU
        for (uint256 d; d < 30; ++d) {
            vm.warp(block.timestamp + 1 days - 1);
            Arclaw.OutcomeInput[] memory tb = _table(address(nvda), P1);
            vm.prank(op);
            box.operatorSetPrizes(M1, tb); // the repricing bot keeps running
        }
        uint256 t = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        box.open(M1, 1, t);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M1, 3);
        assertEq(box.sealedReserve(), 3 * P1, "30 days on, the 3 USDC is still locked");
    }

    // ------------------------------------------------------------------ M-02

    /// M-02: every exit of a Pending opening (reveal, retry, returnBoxes, rescue) needs the coordinator's getRequest.
    /// A dead, paused or upgraded coordinator (or one that never reports `expired`) strands the boxes and their
    /// price in pendingReserve forever; there is no contract-side timeout.
    function test_m02_deadCoordinatorStrandsPendingOpenings() public {
        _play(alice, M1, 2);
        (uint256 id,) = _open(alice, M1, 2);
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(ID20Coordinator.getRequest.selector), "dead");
        vm.warp(block.timestamp + 60 days);

        vm.startPrank(alice);
        vm.expectRevert();
        box.reveal(id);
        vm.expectRevert();
        box.retry(id);
        vm.expectRevert();
        box.returnBoxes(id);
        vm.expectRevert(); // rescue reaches _reveal, which also reads the coordinator
        box.rescue(id);
        vm.stopPrank();
        assertEq(box.pendingReserve(), 2 * P1, "2 USDC locked with no exit");
    }

    /// Coordinator that answers but never marks the request expired (deadline 0): same dead end.
    function _unfulfilled() internal pure returns (ID20Coordinator.Request memory r) {}

    function test_m02_neverExpiringRequestStrandsOpening() public {
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.mockCall(address(vrf), abi.encodeWithSelector(ID20Coordinator.getRequest.selector), abi.encode(_unfulfilled()));
        vm.warp(block.timestamp + 60 days);
        vm.startPrank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.returnBoxes(id);
        vm.expectRevert(Arclaw.NotReady.selector);
        box.reveal(id);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ L-01

    /// L-01: _call forwards all gas. An opener whose receive burns gas makes the keeper's reveal (and rescue, and the
    /// top-up leg of a keeper retry) burn ~63/64 of the gas limit, and OOG-revert under ~3M gas, since the credit
    /// fallback must fit in the last 1/64. The opener thereby takes the reveal timing away from the keeper.
    function test_l01_openerBurnsKeeperGasOnRefund() public {
        vm.deal(address(box), 10 ether); // float so the refund is paid, not owed
        box.sweep(address(nvda), address(this), nvda.balanceOf(address(box))); // cards short: refund leg runs
        GasBurner g = new GasBurner(box);
        uint256 id = g.playOpen{value: P1}(M1, P1);
        (,,,,,, uint256 req,) = box.openings(id);
        vrf.fulfill(req, _wordFor(0));

        (bool ok,) = address(box).call{gas: 2_000_000}(abi.encodeCall(Arclaw.reveal, (id)));
        assertFalse(ok, "keeper reveal with 2M gas runs out");

        uint256 g0 = gasleft();
        box.reveal{gas: 10_000_000}(id);
        uint256 used = g0 - gasleft();
        assertGt(used, 9_000_000, "one 1-USDC reveal cost the keeper > 9M gas");
        assertGt(box.credit(address(g)), 0, "refund parked as credit");
    }

    // ------------------------------------------------------------------ L-02

    /// L-02: _payTopUp pays at most the unreserved balance, and IOUs count as reserved. With any IOU open, an
    /// opener's VRF top-up refunded by D20 is absorbed into the IOU pool and openingTopUp is deleted: lost for good.
    function test_l02_topUpLostWhileAnIouIsOpen() public {
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

        vm.warp(block.timestamp + 1 days + 61); // carol's request expired, her table aged out
        uint256 before = carol.balance;
        vm.prank(carol);
        box.returnBoxes(carolId);
        assertEq(carol.balance - before, 0, "carol's 0.2 top-up is gone");
        assertEq(box.openingTopUp(carolId), 0, "and nothing records it any more");
    }
}
