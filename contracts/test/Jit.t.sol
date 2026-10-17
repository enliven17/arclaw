// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {Vm} from "forge-std/Vm.sol";

/// Just-in-time purchase of short cards at reveal.
contract JitTest is Base {
    function setUp() public override {
        super.setUp();
        _forceSingle(M1, address(nvda), 0.75 ether); // cards 0.30 / 0.30 / 0.15 USDC of NVDA at $200
        box.sweep(address(nvda), address(1), 100 ether); // no inventory at all
        box.setJit(address(desk), 100, 60, uint128(5 ether), 0); // 1% slippage
    }

    function _revealOne(bytes32 w) internal returns (uint256 id) {
        _play(alice, M1, 1);
        uint256 req;
        (id, req) = _open(alice, M1, 1);
        vrf.fulfill(req, w);
        box.reveal(id);
    }

    function test_jit_buysShortCardsFromRevenue() public {
        uint256 before = alice.balance;
        vm.recordLogs();
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        uint256 poolBefore = address(box).balance;
        box.reveal(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countEvents(logs, Arclaw.JitBought.selector), 3);
        assertEq(_countEvents(logs, Arclaw.Refunded.selector), 0);
        assertEq(nvda.balanceOf(alice), 0.00375 ether, "the whole pack, in stock");
        assertEq(box.cardsPaid(), 3);
        assertEq(alice.balance, before - P1, "no refund: the player got stock");
        // revenue paid for it: at most 0.75 x 1.01; the first NVDA buy's slippage surplus covers part of the next card
        uint256 spent = poolBefore - address(box).balance;
        assertGt(spent, 0.75 ether);
        assertLe(spent, 0.7575 ether + 3);
    }

    function test_jit_offRefunds() public {
        box.setJit(address(0), 0, 0, 0, 0);
        uint256 before = alice.balance;
        _revealOne(keccak256("w"));
        assertEq(alice.balance, before - P1 + 0.75 ether);
        assertEq(box.cardsRefunded(), 3);
    }

    function test_jit_deskMustBeSink() public {
        box.setSink(address(desk), false);
        _revealOne(keccak256("w"));
        assertEq(box.cardsRefunded(), 3);
    }

    function test_jit_deskFailureFallsBackToRefund() public {
        nvda.setMinter(address(desk), false); // desk.buy reverts
        uint256 before = alice.balance;
        _revealOne(keccak256("w"));
        assertEq(box.cardsRefunded(), 3);
        assertEq(alice.balance, before - P1 + 0.75 ether);
    }

    function test_jit_perCardCap() public {
        box.setJit(address(desk), 100, 60, uint128(0.2 ether), 0); // only the 0.15 card fits under 0.2
        _revealOne(keccak256("w"));
        assertEq(box.cardsPaid(), 1);
        assertEq(box.cardsRefunded(), 2);
    }

    function test_jit_perRevealCap() public {
        box.setJit(address(desk), 100, 1, uint128(5 ether), 0);
        _revealOne(keccak256("w"));
        assertEq(box.cardsPaid(), 1);
        assertEq(box.cardsRefunded(), 2);
    }

    function test_jit_neverSpendsReserved() public {
        // Bob's 3 boxes are pending: their 3 USDC is reserved. Alice's reveal may only use what is above it.
        _play(bob, M1, 3);
        _open(bob, M1, 3);
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vm.deal(address(box), 3.3 ether); // 3 reserved for bob + 0.3 free after alice's own box is released
        vrf.fulfill(req, keccak256("w"));
        box.reveal(id);
        // Alice's own box is released at reveal, so JIT may spend 3.3 - 3 = 0.3: only the 0.15 card (cost 0.1515)
        // fits; the two 0.30 cards (cost 0.303 each) would dip into bob's reserve and are refunded instead.
        assertEq(box.cardsPaid(), 1);
        assertEq(box.cardsRefunded(), 2);
    }

    function test_reserveFloor_blocksWithdrawNotJit() public {
        box.setJit(address(desk), 100, 60, uint128(5 ether), 2 ether);
        vm.deal(address(box), 2 ether);
        assertEq(box.freeBalance(), 0);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.withdraw(address(this), 1);
        _revealOne(keccak256("w"));
        assertEq(box.cardsPaid(), 3, "the float paid for a short pack");
    }

    function test_jit_configBounds() public {
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setJit(address(desk), 1001, 1, 1, 0);
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setJit(address(desk), 100, 61, 1, 0);
        vm.prank(alice);
        vm.expectRevert();
        box.setJit(address(desk), 100, 1, 1, 0);
    }

    /// Worst case: 20 boxes, 60 short cards across 8 stocks, every one bought on the desk.
    function test_jit_gas_reveal20AllBought() public {
        MockStock[8] memory s;
        address[] memory t = new address[](8);
        uint256[] memory p = new uint256[](8);
        for (uint256 i; i < 8; ++i) {
            s[i] = new MockStock("X.arc");
            s[i].setMinter(address(desk), true);
            (t[i], p[i]) = (address(s[i]), (100 + 50 * i) * 1e6);
        }
        prices.setPrices(t, p);
        box.setMachine(M1, uint128(P1), 3000, 1_000_000, 7500, 7500);
        Arclaw.OutcomeInput[] memory tab = new Arclaw.OutcomeInput[](1);
        tab[0].weight = 1;
        for (uint256 c; c < 3; ++c) {
            tab[0].tokens[c] = t[c * 3];
            tab[0].amounts[c] = (0.25 ether * 1e6 + p[c * 3] - 1) / p[c * 3];
        }
        box.setPrizes(M1, tab);
        _play(alice, M1, 20);
        (uint256 id, uint256 req) = _open(alice, M1, 20);
        vrf.fulfill(req, keccak256("w"));
        uint256 g = gasleft();
        box.reveal(id);
        uint256 used = g - gasleft();
        emit log_named_uint("reveal(20) with 60 JIT buys (mock desk)", used);
        // First buy per stock fills inventory with its rounding surplus, so later buys of the same card may be skipped.
        assertEq(box.cardsPaid(), 60);
        assertLt(used, 10_000_000);
    }
}
