// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// A price source that is down (or swapped for a hostile one): every read reverts.
contract DownSource {
    function priceOf(address) external pure returns (uint256) {
        revert("down");
    }
}

/// A live coordinator whose request is expensive (about 800k gas): the probe must still call it alive.
contract HungryVrf {
    uint256 public nextId = 1;
    mapping(uint256 => uint256) internal _sink;

    function quoteFee(uint32) external pure returns (uint256) {
        return 0.02 ether;
    }

    function requestRandomness(bytes32, uint32, address) external payable returns (uint256 id) {
        for (uint256 i = 1; i <= 35; ++i) {
            _sink[i + nextId * 100] = i; // 35 fresh SSTOREs, ~780k gas
        }
        id = nextId++;
    }
}

/// Independent audit 7a (round 4, commit 7056ee8).
contract A7aFindings is Base {
    uint256 constant T0 = 1_800_000_000; // Base.setUp warp; absolute warps (via_ir)
    address sink = makeAddr("sink");

    receive() external payable {}

    /// Misses booked today (limits rolls over on the next write, so an older day reads as 0 here).
    function _misses() internal view returns (uint256 m) {
        uint32 day;
        (day, m,,,) = box.limits();
        if (day != block.timestamp / 1 days) m = 0;
    }

    // ------------------------------------------------------------------ M-01

    /// M-01 (was: stored misses re-pause the contract on demand). Fixed in round 5: an opening books one miss only,
    /// at its retry, so returning already-retried openings later books nothing; and the breaker never pauses, it
    /// closes `open` until 00:00 UTC. Bob's 13 returns the next day change nothing.
    function test_fixed_m01_retriedOpeningsReturnedLaterBookNoMiss() public {
        box.setPrizes(M1, _table(address(nvda), P1)); // priced at T0
        vm.deal(address(box), 10 ether); // house float for subsidies
        _play(bob, M1, 13);
        uint256[] memory ids = new uint256[](13);
        for (uint256 i; i < 13; ++i) {
            (ids[i],) = _open(bob, M1, 1);
        }
        // D20 hiccup: nothing answered. The keeper retries every expired opening at once.
        vm.warp(T0 + 61);
        for (uint256 i; i < 13; ++i) {
            box.retry(ids[i]);
        }
        assertEq(_misses(), 10, "13 misses, the counter saturates at maxMisses (round 6, 8a I-01)");
        assertFalse(box.paused(), "the breaker never pauses");
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(Arclaw.VrfMisses.selector);
        box.open(M1, 1, tid); // day 1: opens closed by the keeper's own retries (by design)

        // retries unanswered too; a later UTC day, bob's pinned table aged out
        vm.warp(T0 + 1 days + 200);
        box.setPrizes(M1, _table(address(nvda), P1)); // service resumes, no unpause needed
        for (uint256 i; i < 13; ++i) {
            vm.prank(bob);
            box.returnBoxes(ids[i]);
        }
        assertEq(_misses(), 0, "already counted at the retry: nothing booked today");
        assertFalse(box.paused());
        assertEq(box.balanceOf(bob, M1), 13);
        _play(alice, M1, 1);
        _open(alice, M1, 1); // opens work
    }

    /// M-01 residual: openings that were never retried (their table aged out before the keeper could) book their miss
    /// on the day they are returned. That can close `open` until midnight, never pause, and it reopens by itself.
    function test_fixed_m01_unretriedStockClosesOpensOnlyUntilMidnight() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        vm.deal(address(box), 10 ether);
        _play(bob, M1, 10);
        vm.warp(T0 + 1 days - 30); // last minute of the table
        uint256[] memory ids = new uint256[](10);
        for (uint256 i; i < 10; ++i) {
            (ids[i],) = _open(bob, M1, 1);
        }
        vm.warp(T0 + 1 days + 31); // expired, the keeper cannot retry a stale table
        vm.expectRevert(Arclaw.TableStale.selector);
        box.retry(ids[0]);

        uint256 day = (T0 + 3 days) / 1 days;
        vm.warp(day * 1 days + 12 hours); // bob picks a later day
        box.setPrizes(M1, _table(address(nvda), P1));
        for (uint256 i; i < 10; ++i) {
            vm.prank(bob);
            box.returnBoxes(ids[i]);
        }
        assertFalse(box.paused(), "no pause");
        uint256 tid = box.currentTable(M1) - 1;
        _play(alice, M1, 1);
        vm.prank(alice);
        vm.expectRevert(Arclaw.VrfMisses.selector);
        box.open(M1, 1, tid);
        vm.warp((day + 1) * 1 days); // 00:00 UTC: open again, no owner action
        _open(alice, M1, 1);
    }

    // ------------------------------------------------------------------ M-02

    /// Owner batch of the M-02 attack, now forced through a pause: pause, good source, reprice, bad source, unpause.
    function _swapBatch(DownSource bad) internal {
        box.pause();
        box.setPolicy(IPriceSource(address(prices)), 50 ether);
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setPolicy(IPriceSource(address(bad)), 50 ether);
        box.unpause();
    }

    /// M-02 (was: the owner keeps sealed boxes locked by swapping in a reverting price source). Fixed in round 5:
    /// once a table exists the source only changes while paused, and a swap keeps the pause clock counting 4 days
    /// past it, so the daily batch cannot keep refundSealed shut: it opens 3 days after the first pause.
    function test_fixed_m02_sourceSwapNeedsPauseAndRunsTheClock() public {
        DownSource bad = new DownSource();
        box.setPrizes(M1, _table(address(nvda), P1));
        vm.expectRevert(Pausable.ExpectedPause.selector);
        box.setPolicy(IPriceSource(address(bad)), 50 ether);
        box.setPolicy(IPriceSource(address(prices)), 7 ether); // same source: the cap alone moves while live
        _play(alice, M1, 2);

        _swapBatch(bad); // first pause at T0
        for (uint256 d; d < 3; ++d) {
            vm.warp(T0 + d * 1 days + 1 days - 100); // just before the table ages out
            _swapBatch(bad);
            uint256 tid = box.currentTable(M1) - 1;
            vm.prank(alice);
            vm.expectRevert(); // "down" from the price source in the live check
            box.open(M1, 1, tid);
        }
        assertEq(box.pausedSince(), T0, "the clock never restarted");
        assertEq(box.sealedRefundAt(M1), T0 + 3 days);
        vm.warp(T0 + 3 days);
        vm.prank(alice);
        box.refundSealed(M1, 2);
        assertEq(box.balanceOf(alice, M1), 0, "out at the price paid");
    }

    /// The slower cadence (one batch every day and an hour: the table goes stale for an hour each time, so the pause
    /// clock would have reset after a day of "service") still cannot restart the clock: the swap holds it 4 days.
    function test_fixed_m02_slowCadenceCannotResetTheClock() public {
        DownSource bad = new DownSource();
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 1);
        _swapBatch(bad);
        for (uint256 k = 1; k <= 3; ++k) {
            vm.warp(T0 + k * (1 days + 1 hours));
            _swapBatch(bad);
        }
        assertEq(box.pausedSince(), T0);
        vm.warp(T0 + 3 days + 3 hours + 1);
        vm.prank(alice);
        box.refundSealed(M1, 1);
    }

    // ------------------------------------------------------------------ L-01

    /// L-01 (was: the VRF subsidy is paid out of player reserves once the float is gone). Fixed in round 5: the
    /// subsidy only comes from the unreserved balance; when that cannot cover it the opener pays the full fee, so
    /// opens never unback the liabilities.
    function test_fixed_l01_subsidyNeverTouchesReserves() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setJit(address(0), 0, 0, 0, 0);
        vm.deal(address(box), 0); // no float at all
        _play(alice, M1, 50);
        uint256 fee = vrf.fee();
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.VrfFeeTopUp.selector, fee, 0));
        box.open(M1, 1, tid);
        for (uint256 i; i < 50; ++i) {
            vm.prank(alice);
            box.open{value: fee}(M1, 1, tid);
        }
        uint256 liab = box.reservedCredit() + box.pendingReserve() + box.sealedReserve() + box.totalOwed()
            + box.topUpReserve();
        assertEq(address(box).balance, 50 ether, "every fee paid by the opener");
        assertEq(box.topUpReserve(), 50 * fee, "and reserved for them until served (D20 holds it meanwhile)");
        assertEq(liab - box.topUpReserve(), address(box).balance, "player money untouched: still fully backed");
    }

    /// A float that covers one subsidy pays exactly one; the next opener pays the full fee.
    function test_fixed_l01_floatPaysSubsidiesUntilEmpty() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setJit(address(0), 0, 0, 0, 0);
        uint256 fee = vrf.fee(); // under maxVrfSubsidy: fully subsidised while the float lasts
        vm.deal(address(box), fee);
        _play(alice, M1, 2);
        _open(alice, M1, 1); // subsidised
        assertEq(address(box).balance, 2 ether);
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.VrfFeeTopUp.selector, fee, 0));
        box.open(M1, 1, tid);
        // sending more than the fee does not make the subsidy count the caller's own value as house money
        vm.prank(alice);
        box.open{value: 2 * fee}(M1, 1, tid);
        assertEq(address(box).balance, 2 ether, "full fee paid by alice, the extra sent back as change");
        assertEq(box.topUpReserve(), fee);
    }

    // ------------------------------------------------------------------ L-02

    /// A Single-like machine (1 USDC, 0.985 x 0.6 + 0.015 x 9.9, as machines.json's jackpot weight) and the Deploy
    /// default float.
    function _jackpotRound(uint256 float_) internal returns (bool paused, uint256 owedAfter) {
        uint256 M3 = 3;
        box.setMachine(M3, uint128(1 ether), 5000, 100_000, 6000, 8500);
        Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](2);
        t[0] = _pack(address(nvda), 985, 0, 0.6 ether);
        t[1] = _pack(address(nvda), 15, 5, 9.9 ether);
        box.setPrizes(M3, t);
        box.sweep(address(nvda), sink, nvda.balanceOf(address(box))); // launch: no pre-bought inventory
        box.setJit(address(desk), 100, 60, 60 ether, float_); // Deploy._configure
        vm.deal(address(box), float_);

        bytes32 w;
        for (uint256 k;; ++k) {
            w = keccak256(abi.encode("jackpot", k));
            if (uint256(keccak256(abi.encode(w, uint256(0)))) % 1000 >= 985) break;
        }
        _play(alice, M3, 1);
        (uint256 id, uint256 req) = _open(alice, M3, 1);
        vrf.fulfill(req, w);
        box.reveal(id);
        return (box.paused(), box.totalOwed());
    }

    /// L-02: Deploy's default RESERVE_FLOOR (5 USDC) is half its own sizing rule (10x the biggest enabled price)
    /// and under one Single jackpot (9.9 USDC + 1% slippage). A jackpot before ~25 boxes of revenue has built up
    /// leaves an IOU and auto-pauses the whole contract (p ~ 0.15% per box, ~3.7% over the first 25 boxes).
    function test_l02_defaultFloorCannotPayOneSingleJackpot() public {
        (bool paused, uint256 owed_) = _jackpotRound(5 ether);
        assertTrue(paused, "first jackpot pauses the launch");
        assertGt(owed_, 3 ether, "about 4 USDC owed");
    }

    function test_l02_contrast_floor15Pays() public {
        (bool paused, uint256 owed_) = _jackpotRound(15 ether);
        assertFalse(paused);
        assertEq(owed_, 0);
        assertEq(box.cardsPaid(), 3);
    }

    // ------------------------------------------------------------------ L-03

    /// L-03: Deploy reads LAUNCH_MACHINES with envOr(",", [1]). A variable that is SET but empty (an .env line
    /// `LAUNCH_MACHINES=`) parses to an empty array, and _launched treats empty as "every machine on": mainnet would
    /// launch Stack and Vault (jackpot 49.5 / 99 USDC) on a 5 USDC float.
    function test_l03_emptyLaunchMachinesEnvMeansAllOn() public {
        vm.setEnv("A7A_LAUNCH_MACHINES_PROBE", "");
        uint256[] memory single = new uint256[](1);
        single[0] = 1;
        uint256[] memory launch = vm.envOr("A7A_LAUNCH_MACHINES_PROBE", ",", single);
        assertEq(launch.length, 0, "set-but-empty is not the default: it is the all-on list");
    }

    // ------------------------------------------------------------------ INFO

    /// INFO: after the deploy-time pause, refundSealed is open for everyone during the first day of service when the
    /// owner unpauses 2+ days after deploying (pausedSince = deploy). Neutral (refund at price), but surprising.
    function test_info_launchPauseOpensRefundWindow() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        box.pause(); // Deploy._mainnet: paused at deploy
        vm.warp(T0 + 3 days);
        box.setPrizes(M1, _table(address(nvda), P1)); // operator reprices before launch
        box.unpause(); // launch
        _play(alice, M1, 1);
        vm.prank(alice);
        box.refundSealed(M1, 1); // the first buyer can take the price back at once
        assertEq(box.balanceOf(alice, M1), 0);
    }

    // ------------------------------------------------------------------ sound

    /// Sound: pauseIfVrfDown cannot be gas-gamed into a false pause, even with a coordinator whose request costs
    /// ~800k gas: any gas that passes the up-front check leaves the request >= PROBE_GAS.
    function testFuzz_sound_probeNeverFalsePausesExpensiveCoordinator(uint256 g) public {
        g = bound(g, 1_100_000, 3_000_000);
        HungryVrf hv = new HungryVrf();
        Arclaw b2 = new Arclaw("", address(hv), SUBSIDY);
        vm.deal(address(b2), 1 ether);
        (bool ok, bytes memory ret) = address(b2).call{gas: g}(abi.encodeCall(Arclaw.pauseIfVrfDown, ()));
        assertFalse(ok);
        assertEq(bytes4(ret), Arclaw.VrfAlive.selector);
        assertFalse(b2.paused());
        assertEq(address(b2).balance, 1 ether, "fee came back with the revert");
    }

    /// Sound: retry keeps its one-shot limit whoever calls it; a stranger pays the full fee (no subsidy drain) and
    /// only spends the retry the keeper would have made anyway.
    function test_sound_thirdPartyRetryUsesTheOnlyRetry() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        vm.deal(address(box), 1 ether);
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(T0 + 61);
        uint256 fee = vrf.fee();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.VrfFeeTopUp.selector, fee, 0));
        box.retry(id); // a stranger pays the full fee
        vm.prank(bob);
        box.retry{value: fee}(id);
        vm.warp(T0 + 122);
        vm.expectRevert(Arclaw.RetryLimit.selector);
        box.retry(id); // the keeper has nothing left: only returnBoxes after the table ages out
    }
}
