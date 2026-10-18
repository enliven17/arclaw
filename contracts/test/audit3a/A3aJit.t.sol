// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";

/// Auditor 3a: just-in-time buys and liability accounting. L-01 and L-02 flipped to the FIXED behaviour.
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

    /// L-01 fixed: a reveal pays refunds only from the unreserved balance (float included); what it cannot cover is
    /// an IOU (owed) the winner claims later, and the IOU pauses play and open. Refunds already accumulated in the
    /// reveal are kept out of JIT buys. Same scenario: bob's 3 pending boxes stay fully backed.
    function test_fixed_l01_bigWinCannotUnbackOtherPendingBoxes() public {
        box.setMachine(M1, uint128(P1), 5000, 1_000_000, 6000, 9000); // rtpMax <= 9047 (MAX_RTP_BPS after a 5% move)
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
        uint256 before = alice.balance;
        vm.prank(alice);
        box.reveal(id);
        assertEq(box.cardsPaid(), 0, "the 0.6 card is not bought with money already owed as refunds");
        assertEq(alice.balance - before, 1.7 ether, "the float and her own box");
        assertEq(box.owed(alice), 1.3 ether, "the rest is an IOU");
        assertTrue(_backed(), "bob's pending boxes are still backed");
        assertEq(address(box).balance, box.pendingReserve());
        assertTrue(box.paused(), "an IOU pauses play and open");

        // treasury refills; alice pulls her IOU, the owner resumes
        vm.deal(address(box), address(box).balance + 2 ether);
        vm.prank(alice);
        box.claimOwed(alice);
        assertEq(alice.balance - before, 3 ether);
        assertEq(box.totalOwed(), 0);
        box.unpause();
    }

    /// The owner-set buffer: a reveal that leaves less than minBuffer unreserved pauses play, IOU or not.
    function test_fixed_l01_lowBufferPauses() public {
        box.setGuards(500, 1.5 ether);
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vm.deal(address(box), 2 ether); // 1 reserved for alice, 1 float
        vrf.fulfill(req, keccak256("w"));
        vm.prank(alice);
        box.reveal(id); // JIT spends ~0.76: 1.24 left unreserved, under the 1.5 buffer
        assertEq(box.cardsPaid(), 3);
        assertEq(box.totalOwed(), 0);
        assertTrue(box.paused());
        vm.expectRevert();
        box.setGuards(0, 0);
        vm.expectRevert();
        box.setGuards(2001, 0);
    }

    /// L-02 fixed: only the opener (or a keeper, or anyone an hour after the request) may reveal, and sealed revenue
    /// was already reserved, so opening sealed boxes no longer shrinks what the victim's JIT buys may use. With the
    /// stock up 4% (inside maxPriceMoveBps) bob opens his 5 boxes first; alice still gets all three cards.
    function test_fixed_l02_massOpenCannotStarveVictim() public {
        _play(bob, M1, 5); // attacker's sealed boxes, revenue in sealedReserve
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        vm.deal(address(box), 6.2 ether); // bob's 5 sealed + alice's 1 pending + 0.2 float
        _setNvda(208e6); // +4% since the table was priced

        _open(bob, M1, 5);
        vm.prank(bob);
        vm.expectRevert(Arclaw.NotOpener.selector);
        box.reveal(id);

        vm.prank(alice);
        box.reveal(id);
        assertEq(box.cardsPaid(), 3, "bob's open moved sealed into pending: nothing alice could use changed");
        assertEq(box.cardsRefunded(), 0);
    }

    /// Control for L-02: without the attacker's open, the same reveal buys all three cards.
    function test_l02_control_withoutMassOpenAllCardsBought() public {
        _play(bob, M1, 5);
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        vm.deal(address(box), 6.2 ether);
        _setNvda(208e6);
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
