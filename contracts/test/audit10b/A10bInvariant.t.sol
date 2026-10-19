// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {ILuck} from "../../src/LuckVault.sol";
import {MockStock} from "../../src/mocks/MockStock.sol";
import {MockVRFCoordinator} from "../../src/mocks/MockVRFCoordinator.sol";
import {MockPriceSource} from "../../src/mocks/MockPriceSource.sol";
import {MockAstockDesk} from "../../src/mocks/MockAstockDesk.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";
import {ID20Coordinator} from "../../src/vrf/D20Randomness.sol";

/// Fixed boost for one address (the vault is only read at open).
contract FixedLuck is ILuck {
    address public lucky;

    constructor(address l) {
        lucky = l;
    }

    function boostOf(address p) external view returns (uint256) {
        return p == lucky ? 100 : 0;
    }
}

/// Audit 10b: mainnet-like economics. NO prize inventory (every card bought just in time on the desk, as at the
/// mainnet launch), a small float, prices drifting inside and outside the 5 percent guard, VRF fee spikes over the
/// subsidy (top-ups), a boosted opener, expiries, retries, returns, rescues, IOUs, claims, owner withdrawals and
/// outside D20 refunds.
contract A10bHandler is Test {
    Arclaw public box;
    MockVRFCoordinator public vrf;
    MockPriceSource public ps;
    MockStock public nvda;
    MockStock public tsla;
    address[3] public actors;
    uint256[] public openings;

    constructor(Arclaw b, MockVRFCoordinator v, MockPriceSource p, MockStock n, MockStock t) {
        (box, vrf, ps, nvda, tsla) = (b, v, p, n, t);
        actors = [makeAddr("x0"), makeAddr("x1"), makeAddr("x2")];
        for (uint256 i; i < 3; ++i) {
            vm.deal(actors[i], 1e30);
        }
    }

    function actor(uint256 i) external view returns (address) {
        return actors[i];
    }

    function openingsLength() external view returns (uint256) {
        return openings.length;
    }

    function _a(uint256 s) internal view returns (address) {
        return actors[s % 3];
    }

    function _m(uint256 s) internal pure returns (uint256) {
        return (s >> 8) % 2 + 1;
    }

    function play(uint256 s, uint256 n) external {
        if (box.paused()) return;
        n = bound(n, 1, 6);
        (uint128 price,,,,) = box.machines(_m(s));
        vm.prank(_a(s));
        try box.play{value: n * price}(_m(s), n) {} catch {}
    }

    function open(uint256 s, uint256 n, bool spike) external {
        address a = _a(s);
        uint256 m = _m(s);
        uint256 bal = box.balanceOf(a, m);
        if (bal == 0) return;
        n = bound(n, 1, bal > 20 ? 20 : bal);
        if (spike) vrf.setFee(0.15 ether); // above the 0.1 subsidy: the opener tops up
        uint256 tid = box.currentTable(m) - 1;
        vm.prank(a);
        try box.open{value: spike ? 0.07 ether : 0}(m, n, tid) returns (uint256 id, uint256) {
            openings.push(id);
        } catch {}
        vrf.setFee(0.02 ether);
    }

    function fulfill(uint256 i, bytes32 w) external {
        if (openings.length == 0) return;
        (,,,,,, uint256 req,) = box.openings(openings[i % openings.length]);
        try vrf.fulfill(req, w) {} catch {}
    }

    function fulfillStarved(uint256 i, bytes32 w) external {
        if (openings.length == 0) return;
        uint256 id = openings[i % openings.length];
        (,,,, Arclaw.OpeningStatus st,, uint256 req,) = box.openings(id);
        if (st != Arclaw.OpeningStatus.Pending) return;
        ID20Coordinator.Request memory r = vrf.getRequest(req);
        if (r.fulfilled || r.refunded || block.timestamp > r.deadline) return;
        vrf.fulfillStarved(req, w);
    }

    function reveal(uint256 i, uint256 who) external {
        if (openings.length == 0) return;
        uint256 id = openings[i % openings.length];
        (address opener,,,,,,,) = box.openings(id);
        vm.prank(who % 2 == 0 ? opener : address(this));
        try box.reveal(id) {} catch {}
    }

    function rescue(uint256 i) external {
        if (openings.length == 0) return;
        uint256 id = openings[i % openings.length];
        (address opener,,,,,,,) = box.openings(id);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(opener);
        try box.rescue(id) {} catch {}
    }

    function expireAndRetry(uint256 i, uint256 who) external {
        if (openings.length == 0) return;
        uint256 id = openings[i % openings.length];
        (address opener,,,,,,,) = box.openings(id);
        vm.warp(block.timestamp + 61);
        uint256 k = who % 3;
        address caller = k == 0 ? opener : k == 1 ? address(this) : makeAddr("stranger");
        vm.deal(caller, caller.balance + 1 ether);
        vm.prank(caller);
        try box.retry{value: k == 2 ? 0.02 ether : 0}(id) {} catch {}
    }

    function returnExpired(uint256 i) external {
        if (openings.length == 0) return;
        uint256 id = openings[i % openings.length];
        (address opener,,,,,,,) = box.openings(id);
        vm.warp(block.timestamp + 1 days + 61);
        vm.prank(opener);
        try box.returnBoxes(id) {} catch {}
    }

    function outsideRefund(uint256 i) external {
        if (openings.length == 0) return;
        (,,,,,, uint256 req,) = box.openings(openings[i % openings.length]);
        vm.warp(block.timestamp + 61);
        vm.prank(makeAddr("outsider"));
        try vrf.refundRequest(req) {} catch {}
    }

    /// Prices drift; a big jump breaks the 5 percent guard until the operator reprices.
    function drift(uint256 s, uint256 bps, bool up) external {
        MockStock t = s % 2 == 0 ? nvda : tsla;
        bps = bound(bps, 0, 2000);
        uint256 p = ps.priceOf(address(t));
        uint256 np = up ? p * (10_000 + bps) / 10_000 : p * (10_000 - bps) / 10_000;
        if (np < 10e6) np = 10e6;
        address[] memory tk = new address[](1);
        uint256[] memory px = new uint256[](1);
        (tk[0], px[0]) = (address(t), np);
        ps.setPrices(tk, px);
    }

    /// Operator reprices both machines at live prices (the handler is the operator).
    function reprice() external {
        for (uint256 m = 1; m <= 2; ++m) {
            try box.operatorSetPrizes(m, _table(m)) {} catch {}
        }
    }

    function _table(uint256 m) internal view returns (Arclaw.OutcomeInput[] memory t) {
        uint256 price = m == 1 ? 1 ether : 5 ether;
        t = new Arclaw.OutcomeInput[](3);
        uint256[3] memory val = [price * 5300 / 10_000, price * 8000 / 10_000, price * 50_000 / 10_000];
        uint88[3] memory w = [uint88(600), 380, 20];
        uint256 pn = ps.priceOf(address(nvda));
        uint256 pt = ps.priceOf(address(tsla));
        for (uint256 k; k < 3; ++k) {
            t[k].weight = w[k];
            t[k].tier = uint8(k);
            (t[k].tokens[0], t[k].tokens[1], t[k].tokens[2]) = (address(nvda), address(tsla), address(nvda));
            t[k].amounts[0] = (val[k] * 40 / 100 * 1e6 + pn - 1) / pn;
            t[k].amounts[1] = (val[k] * 30 / 100 * 1e6 + pt - 1) / pt;
            t[k].amounts[2] = (val[k] * 30 / 100 * 1e6 + pn - 1) / pn;
        }
    }

    function claimCredit(uint256 s) external {
        vm.prank(_a(s));
        try box.claimCredit() {} catch {}
    }

    function claimOwed(uint256 s) external {
        address a = _a(s);
        vm.prank(a);
        try box.claimOwed(a) {} catch {}
    }

    function refundSealed(uint256 s, uint256 n) external {
        address a = _a(s);
        uint256 bal = box.balanceOf(a, _m(s));
        if (bal == 0) return;
        vm.prank(a);
        try box.refundSealed(_m(s), bound(n, 1, bal)) {} catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 2 days));
    }
}

contract A10bOwnerBot is Test {
    Arclaw public box;

    constructor(Arclaw b) {
        box = b;
    }

    function accept() external {
        box.acceptOwnership();
    }

    /// The owner takes everything freeBalance says is free.
    function withdrawFree() external {
        uint256 f = box.freeBalance();
        if (f != 0) box.withdraw(makeAddr("treasury"), f);
    }

    function fundAndUnpause(uint256 amt) external {
        amt = bound(amt, 0, 30 ether);
        vm.deal(address(this), address(this).balance + amt);
        (bool ok,) = address(box).call{value: amt}("");
        ok;
        if (box.paused()) box.unpause();
    }
}

contract A10bInvariants is Test {
    Arclaw box;
    MockVRFCoordinator vrf;
    MockPriceSource ps;
    MockAstockDesk desk;
    MockStock nvda;
    MockStock tsla;
    A10bHandler h;
    A10bOwnerBot ownerBot;

    function setUp() public {
        vm.warp(1_800_000_000);
        vrf = new MockVRFCoordinator();
        box = new Arclaw("", address(vrf), 0.1 ether);
        nvda = new MockStock("NVDA.arc");
        tsla = new MockStock("TSLA.arc");
        ps = new MockPriceSource();
        desk = new MockAstockDesk(IPriceSource(address(ps)));
        nvda.setMinter(address(desk), true);
        tsla.setMinter(address(desk), true);
        address[] memory tk = new address[](2);
        uint256[] memory px = new uint256[](2);
        (tk[0], tk[1], px[0], px[1]) = (address(nvda), address(tsla), 200e6, 400e6);
        ps.setPrices(tk, px);
        box.setPolicy(IPriceSource(address(ps)), 500 ether);
        box.setSink(address(desk), true);
        box.setMachine(1, 1 ether, 5000, 100_000, 7000, 8500);
        box.setMachine(2, 5 ether, 5000, 100_000, 7000, 8500);
        h = new A10bHandler(box, vrf, ps, nvda, tsla);
        ps.transferOwnership(address(h));
        box.setOperator(address(h));
        box.setKeeper(address(h), true);
        h.reprice();
        assertEq(box.currentTable(1), 1, "table 1 set");
        assertEq(box.currentTable(2), 2, "table 2 set");
        box.setGuards(500, 1); // as Deploy.s.sol
        box.setJit(address(desk), 100, 60, 60 ether, 5 ether); // as Deploy.s.sol
        box.setLimits(2000 ether, 10_000);
        box.setLuck(new FixedLuck(h.actor(0)));
        vm.deal(address(box), 3 ether); // small float, under the reserve floor (tight fundPlan)
        ownerBot = new A10bOwnerBot(box);
        box.transferOwnership(address(ownerBot));
        ownerBot.accept();
        bytes4[] memory skip = new bytes4[](1);
        skip[0] = A10bOwnerBot.accept.selector;
        excludeSelector(FuzzSelector({addr: address(ownerBot), selectors: skip}));
        targetContract(address(h));
        targetContract(address(ownerBot));
    }


    /// Native the coordinator still escrows for Arclaw requests (refundable later).
    function _d20Held() internal view returns (uint256 held) {
        uint256 n = vrf.nextId();
        for (uint256 id = 1; id < n; ++id) {
            ID20Coordinator.Request memory r = vrf.getRequest(id);
            if (!r.fulfilled && !r.refunded) held += vrf.feePaid(id);
        }
    }

    /// Player money that is not an IOU (credit, sealed and pending boxes, VRF top-ups) is always backed by the
    /// balance plus what D20 holds for us, whatever the owner withdrew and however many IOUs exist.
    function invariant_playerReservesBacked() public view {
        uint256 res = box.reservedCredit() + box.pendingReserve() + box.sealedReserve() + box.topUpReserve();
        assertGe(address(box).balance + _d20Held(), res, "player reserves unbacked");
        assertGe(address(box).balance, box.reservedCredit() + box.pendingReserve() + box.sealedReserve(), "core");
    }

    function invariant_owedSumsUp() public view {
        uint256 s;
        for (uint256 i; i < 3; ++i) {
            s += box.owed(h.actor(i));
        }
        assertEq(s, box.totalOwed());
    }

    function invariant_sealedMatchesBoxes() public view {
        uint256 v;
        for (uint256 m = 1; m <= 2; ++m) {
            (uint128 price,,,,) = box.machines(m);
            for (uint256 i; i < 3; ++i) {
                v += box.balanceOf(h.actor(i), m) * price;
            }
        }
        assertEq(box.sealedReserve(), v);
    }

    function invariant_pendingMatchesOpenings() public view {
        uint256 v;
        uint256 n = h.openingsLength();
        for (uint256 i; i < n; ++i) {
            (, uint32 boxes,, uint16 m, Arclaw.OpeningStatus st,,,) = box.openings(h.openings(i));
            if (st == Arclaw.OpeningStatus.Pending || st == Arclaw.OpeningStatus.Fulfilled) {
                (uint128 price,,,,) = box.machines(m);
                v += uint256(boxes) * price;
            }
        }
        assertEq(box.pendingReserve(), v);
    }

    function invariant_cardsBounded() public view {
        assertLe(box.cardsPaid() + box.cardsRefunded(), box.boxesOpened() * 3);
    }

    /// Every share the desk minted is either still in inventory or was paid to a player and counted.
    function invariant_stockAccounted() public view {
        assertEq(nvda.totalSupply(), nvda.balanceOf(address(box)) + box.paidOut(address(nvda)));
        assertEq(tsla.totalSupply(), tsla.balanceOf(address(box)) + box.paidOut(address(tsla)));
    }
}
