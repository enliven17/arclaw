// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {MockVRFCoordinator} from "../src/mocks/MockVRFCoordinator.sol";

/// Drives random plays, opens, fulfills, reveals, retries, links and warps.
contract Handler is Test {
    Arclaw public box;
    MockVRFCoordinator public vrf;
    address[3] actors;
    uint256[] public openings;
    uint256[] public linkIds;
    mapping(uint256 => uint256) public linkPk;
    uint256 nonce;

    constructor(Arclaw b, MockVRFCoordinator v) {
        (box, vrf) = (b, v);
        actors = [makeAddr("a0"), makeAddr("a1"), makeAddr("a2")];
        for (uint256 i; i < 3; ++i) vm.deal(actors[i], 1e30);
    }

    function _actor(uint256 s) internal view returns (address) {
        return actors[s % 3];
    }

    function play(uint256 s, uint256 n) external {
        n = bound(n, 1, 5);
        vm.prank(_actor(s));
        box.play{value: n * box.boxPrice()}(n);
    }

    function open(uint256 s, uint256 n) external {
        address a = _actor(s);
        uint256 bal = box.balanceOf(a, 0);
        if (bal == 0) return;
        n = bound(n, 1, bal > 20 ? 20 : bal);
        vm.prank(a);
        (uint256 id,) = box.open(n);
        openings.push(id);
    }

    function fulfillAndReveal(uint256 i, bytes32 w) external {
        if (openings.length == 0) return;
        uint256 id = openings[i % openings.length];
        (,,, Arclaw.OpeningStatus st,,, uint256 req,) = box.openings(id);
        if (st != Arclaw.OpeningStatus.Pending) return;
        try vrf.fulfill(req, w) {} catch {}
        try box.reveal(id) {} catch {}
    }

    function expireAndRetry(uint256 i) external {
        if (openings.length == 0) return;
        uint256 id = openings[i % openings.length];
        vm.warp(block.timestamp + 61);
        try box.retry(id) {} catch {}
    }

    function createLink(uint256 s, uint256 n) external {
        address a = _actor(s);
        uint256 bal = box.balanceOf(a, 0);
        if (bal == 0) return;
        n = bound(n, 1, bal);
        uint256 pk = uint256(keccak256(abi.encode("link", ++nonce))) % 1e70 + 1;
        vm.prank(a);
        uint256 id = box.createLink(vm.addr(pk), uint32(n), uint64(block.timestamp + 1 hours));
        linkIds.push(id);
        linkPk[id] = pk;
    }

    function claimLink(uint256 i, uint256 s) external {
        if (linkIds.length == 0) return;
        uint256 id = linkIds[i % linkIds.length];
        address to = _actor(s);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(linkPk[id], box.claimDigest(id, to));
        try box.claimLink(id, to, abi.encodePacked(r, ss, v)) {} catch {}
    }

    function reclaimLink(uint256 i) external {
        if (linkIds.length == 0) return;
        uint256 id = linkIds[i % linkIds.length];
        (address sender,,,,) = box.links(id);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(sender);
        try box.reclaimLink(id) {} catch {}
    }
}

contract ArclawInvariants is Test {
    Arclaw box;
    MockVRFCoordinator vrf;
    MockStock nvda;
    Handler handler;

    function setUp() public {
        vrf = new MockVRFCoordinator();
        box = new Arclaw(1 ether, "", address(vrf), 0.1 ether);
        nvda = new MockStock("NVDA.arc");
        nvda.mint(address(box), 1e24);
        Arclaw.Prize[] memory t = new Arclaw.Prize[](2);
        t[0] = Arclaw.Prize(address(nvda), 3, 0, 0.001 ether);
        t[1] = Arclaw.Prize(address(nvda), 1, 1, 0.01 ether);
        box.setPrizes(t);
        handler = new Handler(box, vrf);
        targetContract(address(handler));
    }

    /// Escrowed link boxes are exactly the contract's own box balance.
    function invariant_escrowMatchesBalance() public view {
        assertEq(box.balanceOf(address(box), 0), box.escrowedBoxes());
    }

    /// Every card revealed was either paid or refunded, never more than 3 per opened box.
    function invariant_cardsBounded() public view {
        assertLe(box.cardsPaid() + box.cardsRefunded(), box.boxesOpened() * 3);
    }

    /// Prize tokens out == what the counter says.
    function invariant_paidOutMatchesBalances() public view {
        assertEq(nvda.balanceOf(address(box)) + box.paidOut(address(nvda)), 1e24);
    }
}
