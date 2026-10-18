// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {ArclawLinks} from "../../src/ArclawLinks.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {MockStock} from "../../src/mocks/MockStock.sol";
import {MockPriceSource} from "../../src/mocks/MockPriceSource.sol";
import {MockAstockDesk} from "../../src/mocks/MockAstockDesk.sol";
import {MockVRFCoordinator} from "../../src/mocks/MockVRFCoordinator.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";
import {ID20Coordinator} from "../../src/vrf/D20Randomness.sol";
import {RejectingWallet, A2Draw} from "./A2Utils.sol";

/// Actors: 3 EOAs + 1 smart account that rejects native; owner + operator (this handler); a VRF coordinator
/// that is honest about words but adversarial about timing (late, starved callbacks, redeliveries, stale
/// callbacks, late words after retry, refunds) and fee level.
contract A2Handler is Test {
    Arclaw public box;
    ArclawLinks public links;
    MockVRFCoordinator public vrf;
    MockPriceSource public ps;
    MockAstockDesk public desk;
    MockStock[3] public stk;
    address[4] public actors;
    address public treasury = makeAddr("treasury");

    struct TableGhost {
        uint256 price;
        uint256 floorBps;
        uint256 capBps;
        uint256 total;
        uint256[] weights;
        uint256[] values;
    }

    mapping(uint256 => TableGhost) internal tg;
    uint256[] public openingIds;
    mapping(uint256 => uint256[]) public reqsOf;
    mapping(uint256 => bool) public lateReq; // fulfilled by us after it was superseded (D20 would never do this)

    struct LinkGhost {
        uint256 pk;
        address sender;
    }

    uint256[] public linkIds;
    mapping(uint256 => LinkGhost) public lg;
    uint256 nonce;

    // ghosts
    mapping(address => uint256) public stockIn;
    uint256 public revealedBoxes;
    uint256 public creditAdded;
    uint256 public creditClaimed;
    uint256 public violations; // bitmask, see V_*
    uint256 public solvencyBreaches; // credits > native balance after a call (reported, not asserted)
    uint256 public worstCaseBreaches; // native + inventory < credits + pending worst-case refunds
    mapping(bytes32 => uint256) public calls;

    uint256 constant V_BAND = 1;
    uint256 constant V_DRAW = 2;
    uint256 constant V_REFUND = 4;
    uint256 constant V_PAID = 8;
    uint256 constant V_REROLL = 16;
    uint256 constant V_LINK = 32;
    uint256 constant V_REDELIVER = 64;
    uint256 constant V_REVEAL_NOT_READY = 128;
    uint256 constant V_REVEAL_FAILED = 256;
    uint256 constant V_CALLBACK_OOG = 512;
    uint256 constant V_ACCESS = 1024;

    constructor() {
        vm.warp(1_800_000_000);
        vrf = new MockVRFCoordinator();
        box = new Arclaw("", address(vrf), 0.05 ether);
        links = new ArclawLinks(IERC1155(address(box)));
        ps = new MockPriceSource();
        desk = new MockAstockDesk(IPriceSource(address(ps)));
        address[] memory t = new address[](3);
        uint256[] memory p = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            stk[i] = new MockStock("S.arc");
            stk[i].setMinter(address(desk), true);
            uint256 seed = i == 2 ? 1e15 : 50 ether; // stock 2 starts nearly empty: shortfalls happen
            stk[i].mint(address(box), seed);
            stockIn[address(stk[i])] = seed;
            (t[i], p[i]) = (address(stk[i]), (150 + 100 * i) * 1e6);
        }
        ps.setPrices(t, p);
        box.setPolicy(IPriceSource(address(ps)), 20 ether);
        box.setOperator(address(this));
        box.setSink(address(desk), true);
        box.setMachine(1, 1 ether, 5000, 100_000, 6000, 8500);
        box.setMachine(2, 5 ether, 5000, 100_000, 6000, 8500);
        _setTable(1, 0);
        _setTable(2, 1);
        actors = [makeAddr("p0"), makeAddr("p1"), makeAddr("p2"), address(new RejectingWallet())];
        for (uint256 i; i < 4; ++i) vm.deal(actors[i], 1e24);
    }

    receive() external payable {}

    // ------------------------------------------------------------------ helpers

    function actorCount() external pure returns (uint256) {
        return 4;
    }

    function openingCount() external view returns (uint256) {
        return openingIds.length;
    }

    function linkCount() external view returns (uint256) {
        return linkIds.length;
    }

    function reqCount(uint256 id) external view returns (uint256) {
        return reqsOf[id].length;
    }

    function maxValueOf(uint256 tableId) public view returns (uint256 mx) {
        uint256[] storage v = tg[tableId].values;
        for (uint256 i; i < v.length; ++i) if (v[i] > mx) mx = v[i];
    }

    function _a(uint256 s) internal view returns (address) {
        return actors[s % 4];
    }

    function _m(uint256 s) internal pure returns (uint256) {
        return (s >> 8) % 2 + 1;
    }

    function _flag(uint256 v) internal {
        violations |= v;
    }

    function _setTable(uint256 m, uint256 seed) internal returns (bool) {
        (uint128 price, uint16 fl, uint32 cap,,) = box.machines(m);
        if (price == 0) return false;
        Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](2);
        for (uint256 k; k < 2; ++k) {
            uint256 target = k == 0 ? uint256(price) / 2 : uint256(price) * 3 / 2;
            t[k].weight = k == 0 ? 3 : 1;
            t[k].tier = uint8(k);
            for (uint256 c; c < 3; ++c) {
                MockStock s = stk[(seed + k + c) % 3];
                uint256 px = ps.priceOf(address(s));
                uint256 v = target / 3 + 1;
                t[k].tokens[c] = address(s);
                t[k].amounts[c] = (v * 1e6 + px - 1) / px;
            }
        }
        try box.operatorSetPrizes(m, t) {
            uint256 id = box.tableCount() - 1;
            Arclaw.Outcome[] memory o = box.outcomes(m);
            TableGhost storage g = tg[id];
            (g.price, g.floorBps, g.capBps) = (price, fl, cap);
            for (uint256 i; i < o.length; ++i) {
                g.weights.push(o[i].weight);
                g.values.push(o[i].value);
                g.total += o[i].weight;
            }
            return true;
        } catch {
            return false;
        }
    }

    function _countCall(string memory n) internal {
        ++calls[keccak256(bytes(n))];
    }

    /// Book-keeping after every call: solvency metrics (reported, these are known to break; see PoC M-2).
    function _post() internal {
        uint256 cr;
        for (uint256 i; i < 4; ++i) cr += box.credit(actors[i]);
        if (cr > address(box).balance) ++solvencyBreaches;
        uint256 liab = cr;
        for (uint256 i; i < openingIds.length; ++i) {
            (, uint32 boxes, uint32 tableId,, Arclaw.OpeningStatus st,,,) = box.openings(openingIds[i]);
            if (st == Arclaw.OpeningStatus.Pending || st == Arclaw.OpeningStatus.Fulfilled) {
                liab += uint256(boxes) * maxValueOf(tableId);
            }
        }
        uint256 assets = address(box).balance;
        for (uint256 i; i < 3; ++i) {
            assets += stk[i].balanceOf(address(box)) * ps.priceOf(address(stk[i])) / 1e6;
        }
        if (assets < liab) ++worstCaseBreaches;
    }

    function _scanCredits(Vm.Log[] memory logs) internal {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(box) && logs[i].topics[0] == Arclaw.CreditAdded.selector) {
                creditAdded += abi.decode(logs[i].data, (uint256));
            }
        }
    }

    function _vrfTopUp() internal view returns (uint256) {
        uint256 fee = vrf.fee();
        uint256 sub = box.maxVrfSubsidy();
        return fee > sub ? fee - sub : 0;
    }

    // ------------------------------------------------------------------ players

    function play(uint256 s, uint256 n) external {
        _countCall("play");
        n = bound(n, 1, 6);
        uint256 m = _m(s);
        (uint128 price,,,,) = box.machines(m);
        vm.prank(_a(s));
        try box.play{value: n * price}(m, n) {} catch {}
        _post();
    }

    function gift(uint256 s, uint256 r) external {
        _countCall("gift");
        address a = _a(s);
        uint256 m = _m(s);
        if (box.balanceOf(a, m) == 0) return;
        address[] memory to = new address[](1);
        to[0] = _a(r);
        vm.prank(a);
        box.gift(m, to);
        _post();
    }

    function open(uint256 s, uint256 n, uint256 extra) external {
        _countCall("open");
        address a = _a(s);
        uint256 m = _m(s);
        uint256 bal = box.balanceOf(a, m);
        if (bal == 0) {
            (uint128 price,,,,) = box.machines(m);
            vm.prank(a);
            try box.play{value: 3 * uint256(price)}(m, 3) {} catch {
                return;
            }
            bal = 3;
        }
        n = bound(n, 1, bal > 20 ? 20 : bal);
        uint256 value = _vrfTopUp() + bound(extra, 0, 0.01 ether);
        uint256 shown = box.currentTable(m) - 1;
        vm.recordLogs();
        vm.prank(a);
        try box.open{value: value}(m, n, shown) returns (uint256 id, uint256 req) {
            openingIds.push(id);
            reqsOf[id].push(req);
        } catch {}
        _scanCredits(vm.getRecordedLogs());
        _post();
    }

    function reveal(uint256 i, uint256 callerSeed) external {
        _countCall("reveal");
        if (openingIds.length == 0) return;
        uint256 id = openingIds[i % openingIds.length];
        (address opener, uint32 boxes, uint32 tableId,, Arclaw.OpeningStatus st, uint64 at, uint256 req, bytes32 w0) =
            box.openings(id);
        if (st != Arclaw.OpeningStatus.Pending && st != Arclaw.OpeningStatus.Fulfilled) return;
        ID20Coordinator.Request memory r = vrf.getRequest(req);
        bool ready = st == Arclaw.OpeningStatus.Fulfilled || r.fulfilled;
        if (st == Arclaw.OpeningStatus.Fulfilled && w0 != r.randomness) _flag(V_REROLL);

        uint256 nativeBefore = opener.balance;
        uint256 creditBefore = box.credit(opener) + box.owed(opener); // a refund is pushed, credited or owed
        address caller = _a(callerSeed);
        bool allowed = caller == opener || block.timestamp >= uint256(at) + 1 hours; // PUBLIC_REVEAL_AFTER
        uint256[3] memory tokBefore;
        for (uint256 k; k < 3; ++k) tokBefore[k] = stk[k].balanceOf(opener);

        vm.recordLogs();
        vm.prank(caller);
        try box.reveal(id) {
            if (!ready) _flag(V_REVEAL_NOT_READY);
            if (!allowed) _flag(V_ACCESS);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            _checkReveal(logs, tableId, r.randomness, opener, nativeBefore, creditBefore, tokBefore);
            revealedBoxes += boxes;
        } catch {
            vm.getRecordedLogs();
            if (ready && allowed) _flag(V_REVEAL_FAILED);
        }
        _post();
    }

    function _checkReveal(
        Vm.Log[] memory logs,
        uint256 tableId,
        bytes32 word,
        address opener,
        uint256 nativeBefore,
        uint256 creditBefore,
        uint256[3] memory tokBefore
    ) internal {
        TableGhost storage g = tg[tableId];
        uint256 refunds;
        uint256 credits;
        uint256[3] memory paid;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(box)) continue;
            bytes32 sig = logs[i].topics[0];
            if (sig == Arclaw.OutcomeDrawn.selector) {
                (uint256 b,, uint256 idx, uint256 value) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                if (A2Draw.draw(g.weights, g.total, word, b) != idx || g.values[idx] != value) _flag(V_DRAW);
                if (value * 10_000 < g.floorBps * g.price || value * 10_000 > g.capBps * g.price) _flag(V_BAND);
            } else if (sig == Arclaw.CardDrawn.selector) {
                (,,, uint256 amount,, bool ok) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, uint256, bool));
                address token = address(uint160(uint256(logs[i].topics[3])));
                if (ok) {
                    for (uint256 k; k < 3; ++k) if (address(stk[k]) == token) paid[k] += amount;
                }
            } else if (sig == Arclaw.Refunded.selector) {
                (,, uint256 amount) = abi.decode(logs[i].data, (uint256, uint256, uint256));
                refunds += amount;
            } else if (sig == Arclaw.CreditAdded.selector) {
                credits += abi.decode(logs[i].data, (uint256));
            }
        }
        creditAdded += credits;
        uint256 delivered = (opener.balance - nativeBefore) + (box.credit(opener) + box.owed(opener) - creditBefore);
        if (delivered != refunds) _flag(V_REFUND);
        for (uint256 k; k < 3; ++k) {
            if (stk[k].balanceOf(opener) - tokBefore[k] != paid[k]) _flag(V_PAID);
        }
    }

    function retry(uint256 i, uint256 callerSeed) external {
        _countCall("retry");
        if (openingIds.length == 0) return;
        uint256 id = openingIds[i % openingIds.length];
        (,,,, Arclaw.OpeningStatus st,, uint256 req,) = box.openings(id);
        bool anyFulfilled = _anyFulfilled(id);
        vm.recordLogs();
        vm.prank(_a(callerSeed));
        try box.retry{value: _vrfTopUp()}(id) returns (uint256 nreq) {
            if (st != Arclaw.OpeningStatus.Pending || anyFulfilled) _flag(V_REROLL);
            if (block.timestamp <= vrf.getRequest(req).deadline) _flag(V_REROLL);
            reqsOf[id].push(nreq);
        } catch {}
        _scanCredits(vm.getRecordedLogs());
        _post();
    }

    function returnBoxes(uint256 i, uint256 callerSeed) external {
        _countCall("returnBoxes");
        if (openingIds.length == 0) return;
        uint256 id = openingIds[i % openingIds.length];
        (address opener,,,, Arclaw.OpeningStatus st,,,) = box.openings(id);
        address caller = _a(callerSeed);
        bool anyFulfilled = _anyFulfilled(id);
        vm.prank(caller);
        try box.returnBoxes(id) {
            if (caller != opener) _flag(V_ACCESS);
            if (st != Arclaw.OpeningStatus.Pending || anyFulfilled) _flag(V_REROLL);
        } catch {}
        _post();
    }

    function claimCredit(uint256 s) external {
        _countCall("claimCredit");
        address a = _a(s);
        uint256 c = box.credit(a);
        vm.prank(a);
        try box.claimCredit() {
            creditClaimed += c;
        } catch {}
        _post();
    }

    function _anyFulfilled(uint256 id) internal view returns (bool) {
        uint256[] storage rs = reqsOf[id];
        for (uint256 k; k < rs.length; ++k) {
            if (!lateReq[rs[k]] && vrf.getRequest(rs[k]).fulfilled) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ links

    function createLink(uint256 s, uint256 n, uint256 ttl) external {
        _countCall("createLink");
        address a = _a(s);
        uint256 m = _m(s);
        uint256 bal = box.balanceOf(a, m);
        if (bal == 0) return;
        n = bound(n, 1, bal);
        uint256 pk = uint256(keccak256(abi.encode("a2link", ++nonce))) % 1e70 + 1;
        uint256 id = links.nextLinkId();
        vm.prank(a);
        try box.safeTransferFrom(a, address(links), m, n, abi.encode(vm.addr(pk), block.timestamp + bound(ttl, 1, 600))) {
            linkIds.push(id);
            lg[id] = LinkGhost(pk, a);
        } catch {}
        _post();
    }

    function claimLink(uint256 i, uint256 rs, uint256 atk) external {
        _countCall("claimLink");
        if (linkIds.length == 0) return;
        uint256 id = linkIds[i % linkIds.length];
        (, uint32 boxes, uint16 m,,,) = links.links(id);
        address to = _a(rs);
        address attacker = _a(atk);
        bytes memory sig = _sig(lg[id].pk, id, to);
        // Front-runner replays the signature for a different recipient.
        if (attacker != to) {
            try links.claimLink(id, attacker, sig) {
                _flag(V_LINK);
            } catch {}
        }
        // Wrong key.
        try links.claimLink(id, to, _sig(lg[id].pk + 1, id, to)) {
            _flag(V_LINK);
        } catch {}
        uint256 before = box.balanceOf(to, m);
        try links.claimLink(id, to, sig) {
            if (box.balanceOf(to, m) - before != boxes) _flag(V_LINK);
            try links.claimLink(id, to, sig) {
                _flag(V_LINK);
            } catch {}
        } catch {}
        _post();
    }

    function reclaimLink(uint256 i, uint256 callerSeed) external {
        _countCall("reclaimLink");
        if (linkIds.length == 0) return;
        uint256 id = linkIds[i % linkIds.length];
        address caller = _a(callerSeed);
        vm.prank(caller);
        try links.reclaimLink(id) {
            if (caller != lg[id].sender) _flag(V_ACCESS);
        } catch {}
        _post();
    }

    function _sig(uint256 pk, uint256 id, address to) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, links.claimDigest(id, to));
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------ adversarial VRF

    function vrfFulfill(uint256 i, bytes32 w, uint256 mode) external {
        _countCall("vrfFulfill");
        if (openingIds.length == 0) return;
        uint256 id = i % 2 == 0 ? openingIds[openingIds.length - 1] : openingIds[(i >> 1) % openingIds.length];
        (,,,, Arclaw.OpeningStatus st,, uint256 req,) = box.openings(id);
        if (st != Arclaw.OpeningStatus.Pending) return;
        ID20Coordinator.Request memory r = vrf.getRequest(req);
        if (r.fulfilled || r.refunded || block.timestamp > r.deadline) return; // D20 acceptance rule
        if (mode % 3 == 0) {
            vrf.fulfillStarved(req, w); // accepted, callback fails
        } else {
            bool ok = vrf.fulfill(req, w);
            if (!ok) _flag(V_CALLBACK_OOG);
        }
        _post();
    }

    function vrfRetryCallback(uint256 i) external {
        _countCall("vrfRetryCallback");
        if (openingIds.length == 0) return;
        uint256 id = openingIds[i % openingIds.length];
        uint256[] storage rs = reqsOf[id];
        for (uint256 k; k < rs.length; ++k) {
            try vrf.retryCallback(rs[k]) {} catch {}
        }
        (,,,, Arclaw.OpeningStatus st,, uint256 req, bytes32 w) = box.openings(id);
        if (st == Arclaw.OpeningStatus.Fulfilled && w != vrf.getRequest(req).randomness) _flag(V_REROLL);
        _post();
    }

    /// Coordinator redelivers a DIFFERENT word for a request that is finished, superseded or already
    /// revealed: Arclaw must reject it.
    function vrfRedeliver(uint256 i, uint256 k, bytes32 w) external {
        _countCall("vrfRedeliver");
        if (openingIds.length == 0) return;
        uint256 id = openingIds[i % openingIds.length];
        uint256[] storage rs = reqsOf[id];
        uint256 rq = rs[k % rs.length];
        (,,,, Arclaw.OpeningStatus st,, uint256 cur, bytes32 w0) = box.openings(id);
        if (st == Arclaw.OpeningStatus.Pending && rq == cur) return; // live request: honest D20 only redelivers its own word
        vm.prank(address(vrf));
        try box.rawFulfillRandomness(rq, w) {
            (,,,, Arclaw.OpeningStatus st2,,, bytes32 w2) = box.openings(id);
            _flag(V_REDELIVER);
            st2;
            w2;
        } catch {}
        (,,,,,,, bytes32 w3) = box.openings(id);
        if (st != Arclaw.OpeningStatus.Pending && w3 != w0) _flag(V_REDELIVER);
        _post();
    }

    /// A word for a superseded (retried) request lands late. Real D20 never does this; Arclaw must ignore it.
    function vrfLateAfterRetry(uint256 i, bytes32 w) external {
        _countCall("vrfLateAfterRetry");
        if (openingIds.length == 0) return;
        uint256 id = openingIds[i % openingIds.length];
        uint256[] storage rs = reqsOf[id];
        if (rs.length < 2) return;
        uint256 old = rs[0];
        ID20Coordinator.Request memory r = vrf.getRequest(old);
        if (r.fulfilled || r.refunded) return;
        (,,,, Arclaw.OpeningStatus st,,, bytes32 w0) = box.openings(id);
        lateReq[old] = true;
        vrf.fulfillStarved(old, w);
        try vrf.retryCallback(old) {} catch {} // full-gas redelivery of the late word
        (,,,, Arclaw.OpeningStatus st2,,, bytes32 w2) = box.openings(id);
        if (st2 != st || w2 != w0) _flag(V_REROLL);
        _post();
    }

    function vrfRefund(uint256 i) external {
        _countCall("vrfRefund");
        if (openingIds.length == 0) return;
        uint256[] storage rs = reqsOf[openingIds[i % openingIds.length]];
        for (uint256 k; k < rs.length; ++k) {
            try vrf.refundRequest(rs[k]) {} catch {}
        }
        _post();
    }

    function vrfSetFee(uint256 f) external {
        _countCall("vrfSetFee");
        vrf.setFee(bound(f, 0.005 ether, 0.2 ether));
    }

    function warp(uint256 dt) external {
        _countCall("warp");
        vm.warp(block.timestamp + bound(dt, 0, 90));
        _post();
    }

    // ------------------------------------------------------------------ operator / owner

    function operatorReprice(uint256 m, uint256 seed, uint256 move) external {
        _countCall("operatorReprice");
        uint256 k = seed % 3;
        uint256 px = ps.priceOf(address(stk[k]));
        px = bound(move, px / 2, px * 3 / 2);
        if (px < 1e6) px = 1e6;
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        (t[0], p[0]) = (address(stk[k]), px);
        ps.setPrices(t, p);
        _setTable(m % 2 + 1, seed);
        _post();
    }

    function operatorSpend(uint256 k, uint256 amt) external {
        _countCall("operatorSpend");
        MockStock s = stk[k % 3];
        amt = bound(amt, 0.01 ether, 5 ether);
        if (address(box).balance < amt) return;
        try box.spend(address(desk), address(s), amt, 1) returns (uint256 got) {
            stockIn[address(s)] += got;
        } catch {}
        _post();
    }

    function ownerPause(bool on) external {
        _countCall("ownerPause");
        if (on && !box.paused()) box.pause();
        else if (!on && box.paused()) box.unpause();
    }

    function ownerTopUp(uint256 amt) external {
        _countCall("ownerTopUp");
        vm.deal(address(this), address(this).balance + bound(amt, 0, 10 ether));
        (bool ok,) = address(box).call{value: bound(amt, 0, 10 ether)}("");
        ok;
        _post();
    }

    function ownerWithdraw(uint256 amt) external {
        _countCall("ownerWithdraw");
        amt = bound(amt, 0, address(box).balance / 4);
        box.withdraw(treasury, amt);
        _post();
    }

    /// Owner reprices a machine without replacing the table (allowed). Band invariant is checked against the
    /// table's set-time price, which is what the contract promises; the economic effect is PoC M-1.
    function ownerSetPrice(uint256 m, uint256 which) external {
        _countCall("ownerSetPrice");
        uint256 id = m % 2 + 1;
        uint128 price = [uint128(1 ether), 2 ether, 5 ether][which % 3];
        box.setMachine(id, price, 5000, 100_000, 6000, 8500);
        _post();
    }

    function setVrfSubsidy(uint256 s) external {
        _countCall("setVrfSubsidy");
        box.setVrfConfig(100_000, bound(s, 0, 0.1 ether));
    }
}

contract A2InvariantTest is Test {
    A2Handler h;
    Arclaw box;
    ArclawLinks links;
    MockVRFCoordinator vrf;

    function setUp() public {
        h = new A2Handler();
        box = h.box();
        links = h.links();
        vrf = h.vrf();
        targetContract(address(h));
    }

    /// I1 escrow: balanceOf(this, id) == escrowed[id] == sum of Open links.
    /// I2 box conservation per machine: sold == holders + escrow + boxes in non-returned openings.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 64
    function invariant_A2_boxesConserved() public view {
        for (uint256 m = 1; m <= 2; ++m) {
            uint256 esc = links.escrowed(m);
            assertEq(box.balanceOf(address(links), m), esc, "escrow == escrow contract balance");
            assertEq(box.balanceOf(address(box), m), 0, "arclaw never holds boxes");
            uint256 open_;
            for (uint256 i; i < h.linkCount(); ++i) {
                (, uint32 boxes, uint16 mid,, ArclawLinks.LinkStatus st,) = links.links(h.linkIds(i));
                if (mid == m && st == ArclawLinks.LinkStatus.Open) open_ += boxes;
            }
            assertEq(open_, esc, "escrow == open links");
            uint256 held;
            for (uint256 i; i < h.actorCount(); ++i) held += box.balanceOf(h.actors(i), m);
            uint256 inOpenings;
            for (uint256 i; i < h.openingCount(); ++i) {
                (, uint32 boxes,, uint16 mid, Arclaw.OpeningStatus st,,,) = box.openings(h.openingIds(i));
                if (mid == m && st != Arclaw.OpeningStatus.Returned) inOpenings += boxes;
            }
            assertEq(box.boxesSold(m), held + esc + inOpenings, "boxes conserved");
        }
    }

    /// I3 no re-roll: at most one (timely) fulfilled request per opening; Fulfilled/Revealed word == the
    /// coordinator's word for the opening's request; Returned openings never had a fulfilled request.
    /// I4 every revealed box drew exactly A2Draw(word) and paid within [floor, cap] of the table at set time.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 64
    function invariant_A2_noRerollAndFairDraw() public view {
        assertEq(h.violations() & (2 | 1 | 16 | 64 | 128), 0, "draw/band/reroll/redeliver/not-ready");
        for (uint256 i; i < h.openingCount(); ++i) {
            uint256 id = h.openingIds(i);
            (,,,, Arclaw.OpeningStatus st,, uint256 req, bytes32 w) = box.openings(id);
            uint256 fulfilled;
            for (uint256 k; k < h.reqCount(id); ++k) {
                uint256 r = h.reqsOf(id, k);
                if (!h.lateReq(r) && vrf.getRequest(r).fulfilled) {
                    ++fulfilled;
                    assertEq(r, req, "fulfilled request is the opening's request");
                }
            }
            assertLe(fulfilled, 1, "one word per opening");
            if (st == Arclaw.OpeningStatus.Returned) assertEq(fulfilled, 0, "never return after a word");
            if (st == Arclaw.OpeningStatus.Fulfilled || st == Arclaw.OpeningStatus.Revealed) {
                assertEq(w, vrf.getRequest(req).randomness, "word is the coordinator's word");
            }
        }
    }

    /// I5 cards: paid + refunded == 3 * revealed boxes. I6 stock conserved. I7 refunds delivered exactly once
    /// (native push or credit), credit ledger exact, paid cards reached the opener.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 64
    function invariant_A2_accounting() public view {
        assertEq(box.cardsPaid() + box.cardsRefunded(), h.revealedBoxes() * 3, "cards exact");
        for (uint256 k; k < 3; ++k) {
            MockStock s = h.stk(k);
            assertEq(s.balanceOf(address(box)) + box.paidOut(address(s)), h.stockIn(address(s)), "stock conserved");
        }
        uint256 cr;
        for (uint256 i; i < h.actorCount(); ++i) cr += box.credit(h.actors(i));
        assertEq(cr, h.creditAdded() - h.creditClaimed(), "credit ledger");
        assertEq(h.violations() & (4 | 8), 0, "refund/paid delivery");
    }

    /// I8 links: front-run redirection, wrong key, replay and non-sender reclaim never succeed; claims deliver.
    /// I9 access: only the opener returns boxes; only the opener reveals before PUBLIC_REVEAL_AFTER.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 64
    function invariant_A2_linksAndAccess() public view {
        assertEq(h.violations() & (32 | 1024), 0, "links/access");
    }

    /// I10 never stuck: from any reachable state every live opening resolves (reveal if a word exists, else
    /// returnBoxes after the deadline), every open link resolves (claim before expiry or reclaim after), and
    /// callbacks always fit the 100k gas limit. Also: a ready reveal never failed during the run.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 64
    function invariant_A2_neverStuck() public {
        assertEq(h.violations() & (256 | 512), 0, "ready reveal failed / callback OOG");
        uint256 snap = vm.snapshotState();
        for (uint256 i; i < h.openingCount(); ++i) {
            uint256 id = h.openingIds(i);
            (address opener,,,, Arclaw.OpeningStatus st,, uint256 req,) = box.openings(id);
            if (st == Arclaw.OpeningStatus.Revealed || st == Arclaw.OpeningStatus.Returned) continue;
            if (st == Arclaw.OpeningStatus.Fulfilled || vrf.getRequest(req).fulfilled) {
                vm.prank(opener);
                uint256 g = gasleft();
                box.reveal(id);
                assertLt(g - gasleft(), 15_000_000, "reveal fits half a block");
            } else {
                uint64 dl = vrf.getRequest(req).deadline;
                if (block.timestamp <= dl) vm.warp(dl + 1);
                vm.prank(opener);
                box.returnBoxes(id);
            }
        }
        for (uint256 i; i < h.linkCount(); ++i) {
            uint256 id = h.linkIds(i);
            (address sender,,, uint40 exp, ArclawLinks.LinkStatus st,) = links.links(id);
            if (st != ArclawLinks.LinkStatus.Open) continue;
            if (block.timestamp <= exp) vm.warp(uint256(exp) + 1);
            vm.prank(sender);
            links.reclaimLink(id);
        }
        vm.revertToState(snap);
    }

    function _agg(string memory k, uint256 v) internal returns (uint256 t) {
        t = vm.envOr(k, uint256(0)) + v;
        vm.setEnv(k, vm.toString(t));
    }

    /// Aggregated over all runs of the campaign (process env as an accumulator).
    function afterInvariant() public {
        uint256 runs = _agg("A2_RUNS", 1);
        uint256 o = _agg("A2_OPENINGS", h.openingCount());
        uint256 r = _agg("A2_REVEALED", h.revealedBoxes());
        uint256 l = _agg("A2_LINKS", h.linkCount());
        uint256 c = _agg("A2_CREDIT_RUNS", h.creditAdded() > 0 ? 1 : 0);
        uint256 sb = _agg("A2_SOLV", h.solvencyBreaches() > 0 ? 1 : 0);
        uint256 wb = _agg("A2_WORST", h.worstCaseBreaches() > 0 ? 1 : 0);
        uint256 rf = _agg("A2_REFUNDED_CARDS", box.cardsRefunded());
        console.log("cumulative runs", runs, "openings", o);
        console.log("  revealed boxes", r, "refunded cards", rf);
        console.log("  links", l, "runs with credit", c);
        console.log("  runs with credits > native", sb, "runs with worst-case undercover", wb);
    }
}
