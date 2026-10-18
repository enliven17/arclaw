// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";

/// Auditor 3a: just-in-time buys and liability accounting. Documents CURRENT behaviour.
contract A3aJitTest is Base {
    function setUp() public override {
        super.setUp();
        _forceSingle(M1, address(nvda), 0.75 ether); // cards 0.30 / 0.30 / 0.15 USDC of NVDA at $200
        box.sweep(address(nvda), address(1), 100 ether); // no inventory: every card is short
        box.setJit(address(desk), 100, 60, uint128(5 ether), 0);
    }

    function _setNvda(uint256 px) internal {
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        (t[0], p[0]) = (address(nvda), px);
        prices.setPrices(t, p);
    }

    function _backed() internal view returns (bool) {
        return address(box).balance >= box.pendingReserve() + box.reservedCredit();
    }

    /// L-01: a reveal pays its refunds from the whole balance, including other openings' pendingReserve. The
    /// reserve only stops the owner (withdraw/spend), not another player's big win. _jitBuy's `owed` also leaves
    /// out the refunds already accumulated earlier in the same reveal, so "JIT never spends reserved" holds per
    /// call only. Here: house fully backed before (bob's 3 + alice's 1 pending, 0.7 float); alice draws a 3x pack;
    /// after her reveal bob's 3 pending boxes are backed by about 1.69.
    function test_l01_bigWinLeavesOtherPendingBoxesUnbacked() public {
        box.setMachine(M1, uint128(P1), 3000, 1_000_000, 6000, 9500);
        Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](2);
        t[0] = _pack(address(nvda), 90, 0, 0.5 ether);
        t[1] = _pack(address(nvda), 10, 3, 3 ether); // cards 1.2 / 1.2 / 0.6
        box.setPrizes(M1, t);
        box.setJit(address(desk), 100, 60, uint128(1 ether), 0); // the 1.2 cards are over the per-card cap

        bytes32 w;
        for (uint256 i;; ++i) {
            w = keccak256(abi.encode(i));
            if (uint256(keccak256(abi.encode(w, uint256(0)))) % 100 >= 90) break; // draws the 3x pack
        }
        _play(bob, M1, 3);
        _open(bob, M1, 3);
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vm.deal(address(box), 4.7 ether);
        assertTrue(_backed(), "fully backed before alice's reveal");

        vrf.fulfill(req, w);
        box.reveal(id);
        assertEq(box.cardsPaid(), 1, "JIT bought the 0.6 card with 1.7 'free' while 2.4 of refunds were owed");
        assertEq(box.pendingReserve(), 3 ether);
        assertLt(address(box).balance, 2 ether);
        assertFalse(_backed(), "bob's pending boxes are no longer backed");
    }

    /// L-02: anyone holding sealed boxes can, in the same transaction, open them right before revealing someone
    /// else's opening (reveal is permissionless). Their sealed-box revenue was free float; opening moves it into
    /// pendingReserve without changing the balance, so the victim's JIT buys fail and the cards are refunded at
    /// min(table value, current value). With the stock up 10% since the table was priced, the victim gets 0.30
    /// USDC for a card that is worth 0.33.
    function test_l02_massOpenForcesVictimRefundsInsteadOfStock() public {
        _play(bob, M1, 5); // attacker's sealed boxes, revenue sitting as float
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        vm.deal(address(box), 5.2 ether); // house float: bob's 5 USDC of sealed revenue + 0.2
        _setNvda(220e6); // +10% since the table was priced

        // atomic: bob opens his 5 boxes, then reveals alice's opening
        _open(bob, M1, 5);
        uint256 before = alice.balance;
        vm.prank(bob);
        box.reveal(id);

        assertEq(box.cardsRefunded(), 2, "the two 0.30 cards no longer fit above bob's fresh reserve");
        assertEq(alice.balance - before, 0.6 ether, "refunded at table value, not the 0.66 the stock is worth");
    }

    /// Control for L-02: without the attacker's open, the same reveal buys all three cards.
    function test_l02_control_withoutMassOpenAllCardsBought() public {
        _play(bob, M1, 5);
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        vm.deal(address(box), 5.2 ether);
        _setNvda(220e6);
        box.reveal(id);
        assertEq(box.cardsPaid(), 3);
    }

    /// INFO: the VRF subsidy is paid from the contract balance without a free-balance check, so with no float
    /// every open leaves the reserved liabilities short by the subsidy.
    function test_info_vrfSubsidyComesOutOfReservedFunds() public {
        _play(alice, M1, 1);
        vm.deal(address(box), 1 ether); // exactly the box revenue, no float
        _open(alice, M1, 1);
        assertEq(box.pendingReserve(), 1 ether);
        assertEq(address(box).balance, 1 ether - 0.02 ether);
    }
}
