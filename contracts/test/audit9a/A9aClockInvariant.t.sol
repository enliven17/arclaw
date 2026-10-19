// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";
import {MockPriceSource} from "../../src/mocks/MockPriceSource.sol";

/// Audit 9a: random sequences of pause, unpause, breaker trips (maxMisses = 1), price-source swaps, machine off/on,
/// reprices, plays, opens and time. The ghost tracks when the CURRENT stop began from the player's point of view.
contract A9aClockHandler is Test {
    Arclaw public box;
    address public owner;
    address public alice;
    address public nvda;
    IPriceSource public main;
    IPriceSource public alt;
    uint256 constant M1 = 1;
    uint256 constant P1 = 1 ether;

    uint256 public ts;
    uint256 public pauseStart; // start of the running pause (0 = unpaused)
    uint256 public lastUnpause;
    uint256 public lastStopStart; // pauseStart of the pause the last unpause ended
    uint256 public offStart; // start of the running off period (0 = on)
    uint256 public lastOn;
    uint256 public lastOffStart;
    uint256 public soldAtOn;
    uint256[] public pending;
    uint256 public trips;
    uint256 public opened;
    uint256 public pausedTrips; // breaker trips booked while paused (the round 6 no-op path)

    /// An automatic pause (a settle) also starts a stop for the ghost.
    modifier sync() {
        _;
        if (box.paused() && pauseStart == 0) pauseStart = ts;
    }

    constructor(Arclaw b, address o, address a, address n, IPriceSource m, IPriceSource x, uint256 t) {
        (box, owner, alice, nvda, main, alt, ts) = (b, o, a, n, m, x, t);
    }

    function _table() internal pure returns (Arclaw.OutcomeInput[] memory t) {
        // nvda at $200: 0.5x (w3) / 1.5x (w1) of a $1 box, split 40/40/20
        t = new Arclaw.OutcomeInput[](2);
        uint256[2] memory v = [uint256(0.5 ether), 1.5 ether];
        for (uint256 i; i < 2; ++i) {
            t[i].weight = i == 0 ? 3 : 1;
            t[i].tier = uint8(i);
            uint256 v0 = v[i] * 40 / 100;
            uint256 v2 = v[i] - 2 * v0;
            t[i].amounts[0] = v0 * 1e6 / 200e6;
            t[i].amounts[1] = v0 * 1e6 / 200e6;
            t[i].amounts[2] = v2 * 1e6 / 200e6;
        }
    }

    function _withNvda(Arclaw.OutcomeInput[] memory t) internal view returns (Arclaw.OutcomeInput[] memory) {
        for (uint256 i; i < t.length; ++i) {
            (t[i].tokens[0], t[i].tokens[1], t[i].tokens[2]) = (nvda, nvda, nvda);
        }
        return t;
    }

    function warp(uint256 dt) external sync {
        ts += bound(dt, 1 minutes, 30 hours);
        vm.warp(ts);
    }

    function pause() external sync {
        if (box.paused()) return;
        vm.prank(owner);
        box.pause();
        pauseStart = ts;
    }

    function unpause() external {
        if (!box.paused()) return;
        vm.prank(owner);
        box.unpause();
        (lastUnpause, lastStopStart, pauseStart) = (ts, pauseStart, 0);
    }

    function reprice() external sync {
        vm.prank(owner);
        box.setPrizes(M1, _withNvda(_table()));
    }

    function swap() external sync {
        if (!box.paused()) return;
        IPriceSource next = box.priceSource() == main ? alt : main;
        vm.prank(owner);
        box.setPolicy(next, 50 ether);
    }

    function off() external sync {
        if (box.machineOff(M1)) return;
        vm.prank(owner);
        box.setMachineActive(M1, false);
        offStart = ts;
    }

    function on() external {
        if (!box.machineOff(M1)) return;
        vm.prank(owner);
        box.setMachineActive(M1, true);
        (lastOn, lastOffStart, offStart, soldAtOn) = (ts, offStart, 0, box.boxesSold(M1));
    }

    function openOne() external sync {
        if (box.paused() || box.machineOff(M1)) return;
        uint256 t = box.currentTable(M1);
        if (t == 0 || ts > box.tablePricedAt(t - 1) + 1 days) {
            vm.prank(owner); // the operator keeps the table fresh
            box.setPrizes(M1, _withNvda(_table()));
            t = box.currentTable(M1);
        }
        vm.prank(alice);
        box.play{value: P1}(M1, 1);
        vm.prank(alice);
        try box.open{value: 0.02 ether}(M1, 1, t - 1) returns (uint256 id, uint256) {
            pending.push(id);
            ++opened;
        } catch {}
    }

    function missOne(uint256 seed) external sync {
        if (pending.length == 0) return;
        uint256 k = seed % pending.length;
        uint256 id = pending[k];
        (uint32 day0, uint16 m0,,,) = box.limits();
        bool done;
        try box.retry{value: 0.02 ether}(id) {} // keeper retry: stays pending
        catch {
            vm.prank(alice);
            try box.returnBoxes(id) {
                done = true;
            } catch {}
        }
        (uint32 day1, uint16 m1,,,) = box.limits();
        if (m1 > 0 && (m1 != m0 || day1 != day0)) {
            ++trips;
            if (box.paused()) ++pausedTrips;
        }
        if (done) {
            pending[k] = pending[pending.length - 1];
            pending.pop();
        }
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 128
contract A9aClockInvariantTest is Base {
    A9aClockHandler h;

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setLimits(2000 ether, 1); // every miss trips the breaker
        MockPriceSource alt = new MockPriceSource();
        address[] memory t = new address[](2);
        uint256[] memory px = new uint256[](2);
        (t[0], t[1], px[0], px[1]) = (address(nvda), address(tsla), 200e6, 400e6);
        alt.setPrices(t, px);
        h = new A9aClockHandler(
            box, address(this), alice, address(nvda), IPriceSource(address(prices)), IPriceSource(address(alt)), 1_800_000_000
        );
        box.setKeeper(address(h), true);
        vm.deal(address(h), 100 ether);
        targetContract(address(h));
    }

    /// Coverage: the run really opened, tripped and tripped while paused (summed across runs in the log).
    function afterInvariant() external view {
        console.log("opened / trips / trips while paused", h.opened(), h.trips(), h.pausedTrips());
    }

    /// While paused, refundSealed opens no later than 3 days after this pause began.
    function invariant_pausedRefundWithin3Days() public view {
        if (!box.paused()) return;
        assertGt(box.pausedSince(), 0);
        assertLe(box.pausedSince(), h.pauseStart());
        assertLe(box.sealedRefundAt(M1), h.pauseStart() + 3 days);
    }

    /// For a day of service after an unpause the stop's clock still counts.
    function invariant_serviceDayKeepsClock() public view {
        if (box.paused() || h.lastStopStart() == 0 || h.ts() >= h.lastUnpause() + 1 days) return;
        assertLe(box.sealedRefundAt(M1), h.lastStopStart() + 3 days);
    }

    /// While the machine is off, refundSealed opens no later than 3 days after it went off, and for a day after it
    /// came back on (boxes were sold).
    function invariant_offRefundWithin3Days() public view {
        if (box.machineOff(M1)) {
            assertLe(box.sealedRefundAt(M1), h.offStart() + 3 days);
        } else if (h.lastOffStart() != 0 && h.ts() < h.lastOn() + 1 days && h.soldAtOn() != 0) {
            assertLe(box.sealedRefundAt(M1), h.lastOffStart() + 3 days);
        }
    }

    /// The resume marker never points before the last unpause (the clock cannot be "un-held").
    function invariant_resumedAtMonotone() public view {
        assertGe(box.resumedAt(), h.lastUnpause());
    }
}
