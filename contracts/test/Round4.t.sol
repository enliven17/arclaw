// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ID20VRF} from "../src/vrf/d20/interfaces/ID20VRF.sol";
import {ID20Coordinator} from "../src/vrf/D20Randomness.sol";

/// A desk that takes the native and delivers nothing (compromised or broken).
contract BlackHoleDesk {
    function buy(address, uint256, address) external payable {}
}

/// Round 4: guardian, daily JIT cap, VRF miss breaker and retry limit, top-up reserve, dead-VRF probe.
contract Round4Test is Base {
    uint256 constant T0 = 1_800_000_000; // Base.setUp warp; absolute warps (via_ir re-reads block.timestamp)
    address guard = makeAddr("guardian");
    address sink = makeAddr("sink");

    receive() external payable {}

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setGuardian(guard);
    }

    function _req(uint256 openingId) internal view returns (uint256 r) {
        (,,,,,, r,) = box.openings(openingId);
    }

    function _misses() internal view returns (uint256 m) {
        (, m,,,) = box.limits();
    }

    function _jitSpent() internal view returns (uint256 s) {
        (,,,, s) = box.limits();
    }

    // ------------------------------------------------------------------ guardian

    function test_guardian_pausesNeverUnpauses() public {
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotGuardian.selector);
        box.pause();

        vm.prank(guard);
        box.pause();
        assertTrue(box.paused());
        vm.prank(guard);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guard));
        box.unpause();

        box.unpause(); // owner
        assertFalse(box.paused());
        box.pause(); // owner keeps pause too
    }

    function test_guardian_onlyOwnerSets() public {
        vm.prank(guard);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guard));
        box.setGuardian(alice);
        vm.expectEmit(address(box));
        emit Arclaw.GuardianSet(address(0));
        box.setGuardian(address(0));
        vm.prank(guard);
        vm.expectRevert(Arclaw.NotGuardian.selector);
        box.pause();
    }

    function test_limits_defaultsAndSetter() public {
        (, uint256 misses, uint256 maxMisses, uint256 jitCap,) = box.limits();
        assertEq(misses, 0);
        assertEq(maxMisses, 10);
        assertEq(jitCap, 2000 ether);
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setLimits(1 ether, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        box.setLimits(1 ether, 5);
        box.setLimits(5 ether, 3);
        (,, maxMisses, jitCap,) = box.limits();
        assertEq(maxMisses, 3);
        assertEq(jitCap, 5 ether);
    }

    // ------------------------------------------------------------------ daily JIT cap

    /// JIT buys stop at limits.jitCap per UTC day; the rest of the cards refund. The next day the cap is fresh.
    function test_jitDailyCap_capsBuysThenRefunds() public {
        box.setJit(address(desk), 100, 60, type(uint128).max, 0);
        box.setLimits(1 ether, 10);
        vm.deal(address(box), 100 ether);
        box.sweep(address(nvda), sink, nvda.balanceOf(address(box))); // no inventory: every card needs a buy
        _play(alice, M1, 10);
        (uint256 id, uint256 req) = _open(alice, M1, 10);
        vrf.fulfill(req, keccak256("cap"));
        box.reveal(id);
        uint256 spent = _jitSpent();
        assertLe(spent, 1 ether, "never above the daily cap");
        assertGt(box.cardsRefunded(), 0, "cards above the cap refund");
        assertGt(box.cardsPaid(), 0, "cards under the cap were bought");

        // same day: nothing left to spend
        _play(alice, M1, 1);
        (id, req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("cap2"));
        box.reveal(id);
        assertLe(_jitSpent(), 1 ether, "still under the cap the same day");
        uint256 paid0 = box.cardsPaid();

        // next day: fresh cap
        vm.warp(T0 + 1 days + 1);
        _play(alice, M1, 1);
        uint256 tid = box.currentTable(M1) - 1;
        vm.expectRevert(Arclaw.TableStale.selector); // reprice first (table aged out)
        vm.prank(alice);
        box.open(M1, 1, tid);
        box.setPrizes(M1, _table(address(nvda), P1));
        (id, req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("cap3"));
        box.reveal(id);
        assertGt(box.cardsPaid(), paid0, "bought again the next day");
        assertGt(_jitSpent(), 0);
        assertLe(_jitSpent(), 1 ether);
    }

    /// A desk that takes the native and delivers nothing drains at most jitCap a day.
    function test_jitDailyCap_boundsABlackHoleDesk() public {
        BlackHoleDesk bad = new BlackHoleDesk();
        box.setSink(address(bad), true);
        box.setJit(address(bad), 100, 60, type(uint128).max, 0);
        box.setLimits(2 ether, 10);
        vm.deal(address(box), 100 ether);
        box.sweep(address(nvda), sink, nvda.balanceOf(address(box)));
        for (uint256 i; i < 5; ++i) {
            _play(alice, M1, 20);
            (uint256 id, uint256 req) = _open(alice, M1, 20);
            vrf.fulfill(req, keccak256(abi.encode("bh", i)));
            box.reveal(id);
        }
        assertLe(address(bad).balance, 2 ether, "lost at most the daily cap");
        assertGt(address(bad).balance, 1 ether, "the cap was actually reached");
        assertEq(box.cardsPaid(), 0);
        assertEq(box.totalOwed(), 0, "the refunds were paid");
    }

    // ------------------------------------------------------------------ retry limit and miss breaker

    /// One re-request per opening, every expired request retried or returned is a miss, maxMisses a day pause.
    function test_breaker_missesPauseTheContract() public {
        box.setLimits(2000 ether, 2);
        _play(alice, M1, 3);
        (uint256 a,) = _open(alice, M1, 1);
        (uint256 b,) = _open(alice, M1, 1);
        vm.warp(T0 + 61);
        box.retry(a); // keeper
        assertEq(_misses(), 1);
        assertFalse(box.paused());
        box.retry(b);
        assertEq(_misses(), 2);
        assertTrue(box.paused(), "second miss of the day pauses");
        assertEq(box.pausedSince(), T0 + 61);
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        box.open(M1, 1, tid);
        // each pending opening keeps at most its one retry
        vm.warp(T0 + 122);
        vm.expectRevert(Arclaw.RetryLimit.selector);
        box.retry(a);
    }

    function test_breaker_returnBoxesCountsAndDayRolls() public {
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(T0 + 1 days + 61);
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(_misses(), 1, "a returned expired request is a miss");
        (uint32 day,,,,) = box.limits();
        assertEq(day, (T0 + 1 days + 61) / 1 days);

        // a new day starts a new count
        box.setPrizes(M1, _table(address(nvda), P1));
        (id,) = _open(alice, M1, 1);
        vm.warp(T0 + 3 days + 62); // expired, its table (set at T0 + 1 day + 61) aged out, a later UTC day
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(_misses(), 1, "counter rolled over");
    }

    /// The dead-coordinator path (7 days, getRequest reverting) is not a withholding: no miss.
    function test_breaker_lostPathIsNotAMiss() public {
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(T0 + 8 days);
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(ID20Coordinator.getRequest.selector), "dead");
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(_misses(), 0);
    }

    /// Every request of an opening carries the same client seed; D20 still gives a new word per requestId.
    function test_retry_sameSeedNewRequest() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vm.warp(T0 + 61);
        uint256 req2 = box.retry(id);
        ID20Coordinator.Request memory r1 = vrf.getRequest(req);
        ID20Coordinator.Request memory r2 = vrf.getRequest(req2);
        assertEq(r1.clientSeed, r2.clientSeed);
        assertEq(r1.clientSeed, keccak256(abi.encode(address(box), id)));
        assertTrue(req != req2);
    }

    // ------------------------------------------------------------------ top-up reserve

    function test_topUp_reservedUntilRevealThenReleased() public {
        vm.deal(address(box), 1 ether);
        vrf.setFee(0.15 ether); // subsidy 0.1, top-up 0.05
        _play(alice, M1, 1);
        uint256 tid = box.currentTable(M1) - 1;
        uint256 free0 = box.freeBalance();
        vm.prank(alice);
        (uint256 id, uint256 req) = box.open{value: 0.05 ether}(M1, 1, tid);
        assertEq(box.topUpReserve(), 0.05 ether);
        // 0.1 subsidy and the reserved 0.05 come off the free balance (the box price moved sealed -> pending)
        assertEq(free0 - box.freeBalance(), 0.15 ether);
        vrf.fulfill(req, keccak256("w"));
        box.reveal(id);
        assertEq(box.topUpReserve(), 0, "served: D20 kept the fee, the reserve is released");
        assertEq(box.openingTopUp(id), 0);
    }

    function test_topUp_retryMovesTheReserve() public {
        vm.deal(address(box), 1 ether);
        vrf.setFee(0.15 ether);
        _play(alice, M1, 1);
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        (uint256 id,) = box.open{value: 0.05 ether}(M1, 1, tid);
        vm.warp(T0 + 61);
        box.retry{value: 0.05 ether}(id); // keeper tops up itself: not an opener top-up
        assertEq(box.openingTopUp(id), 0);
        assertEq(box.topUpReserve(), 0);
    }

    // ------------------------------------------------------------------ dead-VRF probe

    function test_probe_aliveRevertsAndLeavesNoRequest() public {
        _play(alice, M1, 1);
        uint256 next = vrf.nextId();
        uint256 bal = address(box).balance;
        vm.prank(alice);
        vm.expectRevert(Arclaw.VrfAlive.selector);
        box.pauseIfVrfDown{gas: 2_000_000}();
        assertEq(vrf.nextId(), next, "no request persisted");
        assertEq(address(box).balance, bal, "no fee spent");
        assertFalse(box.paused());
    }

    function test_probe_quoteRevertPauses() public {
        _play(alice, M1, 1);
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(ID20VRF.quoteFee.selector), "paused");
        box.pauseIfVrfDown{gas: 2_000_000}();
        assertTrue(box.paused());
        vm.expectRevert(Pausable.EnforcedPause.selector);
        box.pauseIfVrfDown{gas: 2_000_000}();
    }

    /// A caller cannot fake a dead coordinator by starving the probe: its gas is fixed and checked up front.
    function test_probe_starvedGasProvesNothing() public {
        _play(alice, M1, 1);
        vm.mockCallRevert(address(vrf), abi.encodeWithSelector(ID20VRF.requestRandomness.selector), "dead");
        vm.expectRevert(Arclaw.VrfAlive.selector);
        box.pauseIfVrfDown{gas: 1_000_000}();
        assertFalse(box.paused());
    }

    /// A balance under one fee proves nothing either way (the guardian pauses then).
    function test_probe_balanceUnderFeeProvesNothing() public {
        vrf.setFee(10 ether); // more than the contract holds
        _play(alice, M1, 1);
        vm.expectRevert(Arclaw.VrfAlive.selector);
        box.pauseIfVrfDown{gas: 2_000_000}();
        assertFalse(box.paused());
    }

    // ------------------------------------------------------------------ sealedRefundAt view

    function test_sealedRefundAt_matchesRefundSealed() public {
        _play(alice, M1, 1);
        uint256 at = box.sealedRefundAt(M1);
        assertEq(at, T0 + 1 days + 3 days, "table clock: stale after maxTableAge, then 3 days");
        vm.warp(at - 1);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M1, 1);
        vm.warp(at);
        vm.prank(alice);
        box.refundSealed(M1, 1);
        assertEq(box.sealedRefundAt(99), 3 days, "no table: refundable at once");
    }
}
