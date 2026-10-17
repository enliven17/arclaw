// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {ArclawLinks} from "../src/ArclawLinks.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {MockVRFCoordinator} from "../src/mocks/MockVRFCoordinator.sol";
import {MockPriceSource} from "../src/mocks/MockPriceSource.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";

/// Drives random plays, opens, fulfills, reveals, retries, links and warps.
contract Handler is Test {
    Arclaw public box;
    ArclawLinks public links;
    MockVRFCoordinator public vrf;
    address[3] actors;
    uint256[] public openings;
    uint256[] public linkIds;
    mapping(uint256 => uint256) public linkPk;
    uint256 nonce;

    constructor(Arclaw b, ArclawLinks l, MockVRFCoordinator v) {
        (box, links, vrf) = (b, l, v);
        actors = [makeAddr("a0"), makeAddr("a1"), makeAddr("a2")];
        for (uint256 i; i < 3; ++i) vm.deal(actors[i], 1e30);
    }

    function _actor(uint256 s) internal view returns (address) {
        return actors[s % 3];
    }

    function _m(uint256 s) internal pure returns (uint256) {
        return (s >> 8) % 2 + 1;
    }

    function play(uint256 s, uint256 n) external {
        n = bound(n, 1, 5);
        (uint128 price,,,,) = box.machines(_m(s));
        vm.prank(_actor(s));
        box.play{value: n * price}(_m(s), n);
    }

    function open(uint256 s, uint256 n) external {
        address a = _actor(s);
        uint256 bal = box.balanceOf(a, _m(s));
        if (bal == 0) return;
        n = bound(n, 1, bal > 20 ? 20 : bal);
        vm.prank(a);
        (uint256 id,) = box.open(_m(s), n);
        openings.push(id);
    }

    function fulfillAndReveal(uint256 i, bytes32 w) external {
        if (openings.length == 0) return;
        uint256 id = openings[i % openings.length];
        (,,,, Arclaw.OpeningStatus st,, uint256 req,) = box.openings(id);
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
        uint256 bal = box.balanceOf(a, _m(s));
        if (bal == 0) return;
        n = bound(n, 1, bal);
        uint256 pk = uint256(keccak256(abi.encode("link", ++nonce))) % 1e70 + 1;
        uint256 id = links.nextLinkId();
        vm.prank(a);
        box.safeTransferFrom(a, address(links), _m(s), n, abi.encode(vm.addr(pk), block.timestamp + 1 hours));
        linkIds.push(id);
        linkPk[id] = pk;
    }

    function claimLink(uint256 i, uint256 s) external {
        if (linkIds.length == 0) return;
        uint256 id = linkIds[i % linkIds.length];
        address to = _actor(s);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(linkPk[id], links.claimDigest(id, to));
        try links.claimLink(id, to, abi.encodePacked(r, ss, v)) {} catch {}
    }

    function reclaimLink(uint256 i) external {
        if (linkIds.length == 0) return;
        uint256 id = linkIds[i % linkIds.length];
        (address sender,,,,,) = links.links(id);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(sender);
        try links.reclaimLink(id) {} catch {}
    }
}

contract ArclawInvariants is Test {
    Arclaw box;
    ArclawLinks links;
    MockVRFCoordinator vrf;
    MockStock nvda;
    Handler handler;

    function setUp() public {
        vrf = new MockVRFCoordinator();
        box = new Arclaw("", address(vrf), 0.1 ether);
        nvda = new MockStock("NVDA.arc");
        nvda.mint(address(box), 1e24);
        MockPriceSource ps = new MockPriceSource();
        address[] memory tk = new address[](1);
        uint256[] memory px = new uint256[](1);
        (tk[0], px[0]) = (address(nvda), 200e6);
        ps.setPrices(tk, px);
        box.setPolicy(IPriceSource(address(ps)), 0);
        for (uint256 m = 1; m <= 2; ++m) {
            uint256 price = m == 1 ? 1 ether : 5 ether;
            box.setMachine(m, uint128(price), 5000, 100_000, 6000, 8500);
            // 0.5x (w3) and 1.5x (w1): NVDA at $200 -> 1 USDC = 0.005 NVDA
            Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](2);
            for (uint256 k; k < 2; ++k) {
                uint256 each = ((k == 0 ? price / 2 : price * 3 / 2) + 599) / 600; // round up: floor holds
                t[k].weight = k == 0 ? 3 : 1;
                t[k].tier = uint8(k);
                for (uint256 c; c < 3; ++c) {
                    t[k].tokens[c] = address(nvda);
                    t[k].amounts[c] = each;
                }
            }
            box.setPrizes(m, t);
        }
        links = new ArclawLinks(IERC1155(address(box)));
        handler = new Handler(box, links, vrf);
        targetContract(address(handler));
    }

    /// Escrowed link boxes are exactly the contract's own box balance.
    function invariant_escrowMatchesBalance() public view {
        assertEq(box.balanceOf(address(links), 1), links.escrowed(1));
        assertEq(box.balanceOf(address(links), 2), links.escrowed(2));
        assertEq(box.balanceOf(address(box), 1) + box.balanceOf(address(box), 2), 0, "arclaw never holds boxes");
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
