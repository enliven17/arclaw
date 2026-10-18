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
        for (uint256 i; i < 3; ++i) {
            vm.deal(actors[i], 1e30);
        }
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
        uint256 tid51 = box.currentTable(_m(s)) - 1;
        vm.prank(a);
        (uint256 id,) = box.open(_m(s), n, tid51);
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

    /// The operator went offline: tables age out, and three days later sealed boxes refund at their price.
    function staleAndRefundSealed(uint256 s, uint256 n) external {
        address a = _actor(s);
        uint256 bal = box.balanceOf(a, _m(s));
        if (bal == 0) return;
        vm.warp(block.timestamp + 4 days + 1);
        vm.prank(a);
        box.refundSealed(_m(s), bound(n, 1, bal));
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

    /// Round 4 (A6a L-01, A6b INFO-01): an open whose VRF fee is above the house subsidy, so the opener tops up.
    function openWithTopUp(uint256 s) external {
        address a = _actor(s);
        uint256 m = _m(s);
        if (box.balanceOf(a, m) == 0) return;
        vrf.setFee(0.15 ether); // subsidy 0.1: top-up 0.05
        uint256 tid = box.currentTable(m) - 1;
        vm.prank(a);
        try box.open{value: 0.05 ether}(m, 1, tid) returns (uint256 id, uint256) {
            openings.push(id);
        } catch {}
        vrf.setFee(0.02 ether);
    }

    /// Anyone calls D20's permissionless refundRequest on an expired request: the fee (top-up included) lands
    /// before Arclaw knows. Then the owner sweeps whatever freeBalance says is free.
    function outsideRefundThenWithdraw(uint256 i) external {
        if (openings.length == 0) return;
        uint256 id = openings[i % openings.length];
        (,,,,,, uint256 req,) = box.openings(id);
        vm.warp(block.timestamp + 61);
        vm.prank(makeAddr("outsider"));
        try vrf.refundRequest(req) {} catch {}
        uint256 free = box.freeBalance();
        if (free != 0) box.withdraw(makeAddr("treasury"), free);
    }

    /// The opener takes an expired opening back once its table aged out (top-up paid back).
    function returnExpired(uint256 i) external {
        if (openings.length == 0) return;
        uint256 id = openings[i % openings.length];
        (address opener,,,, Arclaw.OpeningStatus st,,,) = box.openings(id);
        if (st != Arclaw.OpeningStatus.Pending) return;
        vm.warp(block.timestamp + 1 days + 61);
        vm.prank(opener);
        try box.returnBoxes(id) {} catch {}
    }

    function acceptOwnership() external {
        box.acceptOwnership();
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
        box.setKeeper(address(handler), true); // the handler reveals like the house bot
        box.setLimits(2000 ether, 10_000); // keep the miss breaker out of the way: the handler expires a lot
        // a reserve floor, as on mainnet (500 USDC): withdraw never takes the float VRF subsidies are paid from
        // (A3a INFO: the subsidy has no free-balance check of its own)
        box.setJit(address(0), 0, 0, 0, 10 ether);
        vm.deal(address(box), 100 ether); // house float: VRF subsidies are paid from it
        // the handler is the owner too, so it can withdraw the free balance (outsideRefundThenWithdraw)
        box.transferOwnership(address(handler));
        handler.acceptOwnership();
        excludeSelector(FuzzSelector({addr: address(handler), selectors: _ownerOnly()}));
        targetContract(address(handler));
    }

    function _ownerOnly() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](1);
        s[0] = Handler.acceptOwnership.selector;
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

    /// Sealed boxes are backed: sealedReserve is exactly the price of every box still sealed (held or escrowed).
    function invariant_sealedReserveMatchesSealedBoxes() public view {
        uint256 sealedValue;
        for (uint256 m = 1; m <= 2; ++m) {
            (uint128 price,,,,) = box.machines(m);
            uint256 held = box.balanceOf(address(links), m);
            for (uint256 i; i < 3; ++i) {
                address actor = vm.addr(uint256(keccak256(abi.encodePacked("a", vm.toString(i))))); // makeAddr("a<i>")
                held += box.balanceOf(actor, m);
            }
            sealedValue += held * price;
        }
        assertEq(box.sealedReserve(), sealedValue);
    }

    /// Every liability (credit, pending and sealed boxes) is backed by native at all times, and no top-up repayment
    /// ever turned into an IOU or unbacked credit, however early D20 refunded and whatever the owner withdrew.
    function invariant_liabilitiesBacked() public view {
        assertGe(address(box).balance, box.reservedCredit() + box.pendingReserve() + box.sealedReserve());
        assertEq(box.totalOwed(), 0, "full inventory: no refund, no IOU");
        assertEq(box.reservedCredit(), 0, "actors take every push: no credit, so none unbacked");
    }

    /// Prize tokens out == what the counter says.
    function invariant_paidOutMatchesBalances() public view {
        assertEq(nvda.balanceOf(address(box)) + box.paidOut(address(nvda)), 1e24);
    }
}
