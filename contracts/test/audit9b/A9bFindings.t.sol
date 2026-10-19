// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";

/// Audit 9b (whole-system, adversarial and economic) against eb8792d. Absolute warps only (via_ir).
/// T0 = 1_800_000_000 is 08:00 UTC.
contract A9bFindingsTest is Base {
    uint256 constant T0 = 1_800_000_000;

    receive() external payable {}

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1)); // table 0: 0.5x (w3), 1.5x (w1)
    }

    // ------------------------------------------------------------------ helpers

    /// A word whose box 0 draws outcome `idx` of the 2-outcome _table (weights 3, 1).
    function _wordFor(uint256 idx) internal pure returns (bytes32 w) {
        for (uint256 i = 1;; ++i) {
            w = bytes32(i);
            uint256 r = uint256(keccak256(abi.encode(w, uint256(0)))) % 4;
            if ((idx == 1) == (r >= 3)) return w;
        }
    }

    /// Every reserve, IOUs included (what _unreserved subtracts).
    function _reserves() internal view returns (uint256) {
        return box.reservedCredit() + box.pendingReserve() + box.sealedReserve() + box.topUpReserve() + box.totalOwed();
    }

    /// IOU backing shortfall: how much of totalOwed the balance does not cover.
    function _deficit() internal view returns (uint256) {
        uint256 bal = address(box).balance;
        uint256 res = _reserves();
        return res > bal ? res - bal : 0;
    }

    /// Alice opens `n` single boxes and wins the 1.5x pack on each, with no inventory, no float and no JIT. The first
    /// reveal makes an IOU and pauses; the rest are revealed while paused (reveals go on during a pause), each adding
    /// 0.5 USDC of unbacked IOU: deficit = 0.5 x n.
    function _iou(uint256 n) internal returns (uint256 iou) {
        box.setJit(address(0), 0, 0, 0, 0);
        vm.deal(address(box), 0);
        box.sweep(address(nvda), address(this), nvda.balanceOf(address(box)));
        _play(alice, M1, n);
        uint256[] memory ids = new uint256[](n);
        uint256[] memory reqs = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            (ids[i], reqs[i]) = _openFullFee(alice);
        }
        for (uint256 i; i < n; ++i) {
            vrf.fulfill(reqs[i], _wordFor(1));
            vm.prank(alice);
            box.reveal(ids[i]);
        }
        iou = box.owed(alice);
        assertEq(_deficit(), n * 0.5 ether, "unbacked IOU");
        assertTrue(box.paused(), "a new IOU pauses");
        assertEq(box.minBuffer(), 0, "minBuffer as Deploy leaves it (setGuards is never called)");
    }

    function _openFullFee(address who) internal returns (uint256 id, uint256 req) {
        uint256 tid = box.currentTable(M1) - 1;
        uint256 fee = vrf.fee();
        vm.prank(who);
        (id, req) = box.open{value: fee}(M1, 1, tid);
    }

    // ================================================================== L-01

    /// L-01 (a): with minBuffer 0 (the Deploy default) an UNFUNDED IOU no longer keeps play paused. The owner unpauses
    /// without funding (or an IOU was created while already paused, e.g. by keeper reveals during a guardian pause),
    /// and plays, opens and reveals go on indefinitely: only the next NEW IOU pauses again. Round 5 re-paused at the
    /// next settle. SECURITY.md / OPERATIONS.md only promise that a FUNDED IOU does not re-pause.
    function test_L01_unfundedIouKeepsSellingAfterUnpause() public {
        uint256 iou = _iou(5); // 2.5 USDC unbacked
        box.unpause(); // owner, IOU unfunded
        nvda.mint(address(box), 100 ether); // inventory back: reveals pay in stock

        for (uint256 i; i < 2; ++i) {
            _play(bob, M1, 1);
            (uint256 b, uint256 rb) = _openFullFee(bob);
            vrf.fulfill(rb, _wordFor(0));
            box.reveal(b);
            assertFalse(box.paused(), "settle with an unfunded IOU does not re-pause");
        }
        // round 5 would have paused at the first of those settles; the IOU only got funded by later revenue
        assertEq(box.owed(alice), iou);
        assertGt(_deficit(), 0, "still unfunded after two box prices of revenue went to it");
    }

    /// L-01 (b): while the IOU is unfunded, new players lose the house VRF subsidy (open without the top-up reverts)
    /// and JIT cannot buy (its free balance counts the IOU), so a short card that the box revenue would have bought
    /// becomes the NEW player's IOU instead of stock.
    function test_L01_unfundedIouCostsNewPlayersSubsidyAndJit() public {
        _iou(3);
        box.unpause();
        box.setJit(address(desk), 100, 60, 60 ether, 0); // JIT on, inventory still empty

        _play(bob, M1, 1);
        uint256 tid = box.currentTable(M1) - 1;
        uint256 fee = vrf.fee();
        vm.expectRevert(abi.encodeWithSelector(Arclaw.VrfFeeTopUp.selector, fee, 0));
        vm.prank(bob);
        box.open(M1, 1, tid); // subsidy is 0: unreserved is 0 while the IOU is unbacked

        (uint256 b, uint256 rb) = _openFullFee(bob);
        vrf.fulfill(rb, _wordFor(0)); // 0.5x pack, all cards short
        box.reveal(b);
        assertEq(nvda.balanceOf(bob), 0, "JIT could not buy: bob's box price went to alice's deficit");
        assertGt(box.owed(bob), 0, "bob's small pack became an IOU");
        assertTrue(box.paused(), "only now (a new IOU) does it pause");
    }

    /// L-01 (c), no owner action: an IOU the owner funded EXACTLY (OPERATIONS.md: "send native USDC until totalOwed
    /// can be claimed, then unpause") is silently unfunded by a top-up payback when D20's refund falls short
    /// (refundBps < 100%, or a refund that does not arrive). _payTopUp's cover ignores totalOwed, the opener's top-up
    /// was never backed (unreserved was 0 at open, so the reservation was phantom), and since round 6 the settle does
    /// not pause (not fresh, minBuffer 0). The contract keeps selling with an unfunded IOU.
    function test_L01_topUpPaybackUnfundsFundedIouWithoutPause() public {
        uint256 iou = _iou(1);
        (bool ok,) = address(box).call{value: _deficit()}(""); // owner funds the IOU exactly
        assertTrue(ok);
        assertEq(_deficit(), 0);
        box.unpause();

        _play(bob, M1, 1);
        (uint256 b,) = _openFullFee(bob); // unreserved 0: full fee, reserved as a top-up nobody backs
        uint256 fee = vrf.fee();
        assertEq(box.openingTopUp(b), fee);

        vm.warp(T0 + 1 days + 61); // request expired, table aged out
        vm.deal(address(vrf), 0); // D20 refund of the expired fee does not arrive (worst case of a partial refund)
        uint256 before = bob.balance;
        vm.prank(bob);
        box.returnBoxes(b);
        assertEq(bob.balance - before, fee, "top-up paid back in full");

        assertFalse(box.paused(), "no pause");
        assertEq(box.totalOwed(), iou);
        assertEq(_deficit(), fee, "alice's funded IOU is unfunded again by the top-up");
        vm.prank(alice);
        box.claimOwed(alice);
        assertEq(box.owed(alice), fee, "alice cannot claim the part the top-up took");
    }

    /// L-01 sound part: while the IOU is unbacked nobody else can take native: owner withdraw, operator spend and the
    /// VRF subsidy are all blocked, and box revenue pays the IOU down first, so the owner cannot extract through it.
    function test_L01_sound_ownerCannotExtractWhileIouUnfunded() public {
        _iou(3);
        box.unpause();
        nvda.mint(address(box), 100 ether);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.withdraw(address(this), 1);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.spend(address(desk), address(nvda), 1, 1);

        for (uint256 i; i < 2; ++i) {
            _play(bob, M1, 1);
            (uint256 b, uint256 rb) = _openFullFee(bob);
            vrf.fulfill(rb, _wordFor(0));
            box.reveal(b);
        }
        assertEq(_deficit(), 0, "two box prices covered the 1.5 IOU");
        vm.prank(alice);
        box.claimOwed(alice);
        assertEq(box.owed(alice), 0, "IOU paid from revenue before any owner withdraw");
        assertEq(box.freeBalance(), 0.5 ether);
    }

    // ================================================================== first-day off clock (round 6)

    /// Sound: the clock drop keys on boxesSold, which only play() raises and nothing lowers. A machine whose every
    /// box was refunded (refundSealed) still counts as sold, so switching it back on keeps the off clock for a day of
    /// service: the owner cannot use "sold == 0" to restart refundSealed's clock on a machine that ever had holders.
    function test_firstDay_sound_refundedMachineKeepsClock() public {
        box.setPrizes(M2, _table(address(nvda), P2));
        _play(alice, M2, 2);
        box.setMachineActive(M2, false); // offClock = T0
        vm.warp(T0 + 3 days);
        vm.prank(alice);
        box.refundSealed(M2, 1);
        vm.warp(T0 + 3 days + 1 hours);
        box.setPrizes(M2, _table(address(nvda), P2));
        box.setMachineActive(M2, true);
        assertEq(box.boxesSold(M2), 2);
        assertEq(box.sealedRefundAt(M2), T0 + 3 days, "off clock kept for the remaining holder");
        vm.prank(alice);
        box.refundSealed(M2, 1); // still open on the first day back
    }

    /// Sound: a never-sold machine cannot gain boxes any other way (returnBoxes needs an opening, which needs boxes),
    /// so clearing its off clock protects nobody's box. Gift, link and transfer paths all need an existing balance.
    function test_firstDay_sound_neverSoldMachineHasNoBoxes() public {
        box.setPrizes(M2, _table(address(nvda), P2));
        box.setMachineActive(M2, false);
        address[] memory to = new address[](1);
        to[0] = bob;
        vm.prank(alice);
        vm.expectRevert(); // ERC1155InsufficientBalance
        box.gift(M2, to);
        vm.expectRevert(Arclaw.MachineOff.selector);
        vm.prank(alice);
        box.play{value: P2}(M2, 1);
        vm.warp(T0 + 5 days);
        box.setPrizes(M2, _table(address(nvda), P2));
        box.setMachineActive(M2, true);
        assertEq(box.sealedRefundAt(M2), T0 + 5 days + 1 days + 3 days, "only the table clock");
    }

    // ================================================================== code size

    /// Arclaw runtime (libraries linked) stays under EIP-170; out/Arclaw.sol/Arclaw.json measured 24,455 B at eb8792d.
    function test_size_arclawRuntimeUnderEip170() public view {
        uint256 size = address(box).code.length;
        assertLt(size, 24_576, "EIP-170");
        assertEq(size, 24_455, "measured at eb8792d (121 B headroom)");
    }
}
