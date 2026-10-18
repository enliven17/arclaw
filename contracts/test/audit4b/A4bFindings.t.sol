// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";

/// Auditor 4b. M-01, L-01, L-02 and L-03 flipped to the FIXED behaviour; INFO still shows the code as it stands.
contract A4bFindingsTest is Base {
    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1)); // 0.5x (w3) / 1.5x (w1) of NVDA at 200 USD, EV 0.75x
    }

    function _setNvda(uint256 px) internal {
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        (t[0], p[0]) = (address(nvda), px);
        prices.setPrices(t, p);
    }

    /// EV of the current M1 table at live prices, bps of the price.
    function _liveRtpBps() internal view returns (uint256) {
        Arclaw.Outcome[] memory o = box.outcomes(M1);
        uint256 ev;
        uint256 w;
        for (uint256 i; i < o.length; ++i) {
            uint256 v;
            for (uint256 c; c < 3; ++c) {
                v += box.valueOf(o[i].cards[c].token, o[i].cards[c].amount);
            }
            ev += v * o[i].weight;
            w += o[i].weight;
        }
        return ev * 10_000 / w / P1;
    }

    /// Word whose box 0 draws outcome number want of the 2-outcome (w3/w1) table.
    function _wordFor(uint256 want) internal pure returns (bytes32 w) {
        for (uint256 i;; ++i) {
            w = keccak256(abi.encode("a4b", i));
            uint256 r = uint256(keccak256(abi.encode(w, uint256(0)))) % 4;
            if ((r < 3 ? 0 : 1) == want) return w;
        }
    }

    // ------------------------------------------------------------------ M-01

    /// M-01 fixed: retry re-runs open's table checks (age, price move, live floor) on the pinned table. Two days on
    /// and +40%, the stale table cannot be revived (paused or not, opener or keeper); only returnBoxes remains, and
    /// it hands back sealed boxes that can only open on a fresh table.
    function test_fixed_m01_retryRefusesAStaleTable() public {
        _play(alice, M1, 20);
        (uint256 id, uint256 req) = _open(alice, M1, 20);
        uint256 shown = box.currentTable(M1) - 1;
        vm.warp(block.timestamp + 2 days); // request long expired, table older than maxTableAge
        _setNvda(280e6); // +40% since the table was priced
        assertGt(_liveRtpBps(), 10_000, "the pinned table is now worth more than the box price");

        _play(bob, M1, 1);
        vm.prank(bob);
        vm.expectRevert(Arclaw.TableStale.selector);
        box.open(M1, 1, shown);

        vm.prank(alice);
        vm.expectRevert(Arclaw.TableStale.selector);
        box.retry(id);
        box.pause();
        vm.expectRevert(Arclaw.TableStale.selector);
        box.retry(id); // nor the keeper

        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.balanceOf(alice, M1), 20, "boxes back, sealed");
        vm.expectRevert(); // the old request is closed
        vrf.fulfill(req, keccak256("any"));
    }

    /// M-01 fixed (price leg, table still young): +40% after 61 s also fails retry (TableStale), and returnBoxes
    /// waits for the table to age out, so the choice never depends on the move the opener watched.
    function test_fixed_m01_retryRefusesAMovedTable() public {
        _play(alice, M1, 20);
        (uint256 id,) = _open(alice, M1, 20);
        vm.warp(block.timestamp + 61);
        _setNvda(280e6);
        vm.prank(alice);
        vm.expectRevert(Arclaw.TableStale.selector);
        box.retry(id);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.returnBoxes(id);
    }

    /// M-01 fixed (other leg): when prices fell, the opener can no longer return at once and re-open on a fresh
    /// table. returnBoxes waits until the pinned table aged out; inside the band the keeper retries first (house
    /// subsidy) and the opening settles on the table it was opened on.
    function test_fixed_m01_returnWaitsForTableAgeKeeperRetriesFirst() public {
        _play(alice, M1, 20);
        (uint256 id,) = _open(alice, M1, 20);
        vm.warp(block.timestamp + 61);
        _setNvda(160e6); // -20%: outside the band
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.returnBoxes(id);
        vm.expectRevert(Arclaw.TableStale.selector);
        box.retry(id);

        _setNvda(206e6); // +3%: inside the band, floor holds
        uint256 req2 = box.retry(id); // the keeper (this contract) retries on the house subsidy
        vrf.fulfill(req2, keccak256("k"));
        box.reveal(id);
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Revealed));

        // a second opening whose table ages out with no keeper retry: only then may the opener take it back
        _setNvda(200e6);
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 1);
        uint256 t1 = block.timestamp;
        (uint256 id2,) = _open(alice, M1, 1);
        vm.warp(t1 + 1 days);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.returnBoxes(id2);
        vm.warp(t1 + 1 days + 1);
        vm.prank(alice);
        box.returnBoxes(id2);
        assertEq(box.balanceOf(alice, M1), 1);
    }

    // ------------------------------------------------------------------ L-01

    /// L-01 fixed: open checks the floor at live prices. A -4.75% move (inside the 5% band) leaves the 0.5x pack
    /// at 47.6%, so open reverts BelowFloor(outcome 0, 4762 bps) until the operator reprices.
    function test_fixed_l01_floorEnforcedAtLivePrices() public {
        _setNvda(190.5e6); // -4.75%, inside the 5% band
        _play(alice, M1, 1);
        uint256 shown = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.BelowFloor.selector, 0, 4762));
        box.open(M1, 1, shown);

        // repriced at 190.5 (common pack a hair over half: card amounts round down at this price)
        Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](2);
        t[0] = _pack(address(nvda), 3, 0, P1 * 5001 / 10_000);
        t[1] = _pack(address(nvda), 1, 1, P1 * 3 / 2);
        box.setPrizes(M1, t);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, _wordFor(0));
        vm.prank(alice);
        box.reveal(id);
        uint256 v = box.valueOf(address(nvda), nvda.balanceOf(alice));
        assertGe(v * 10_000 / P1, 5000, "at least half back");
    }

    /// L-01 fixed (upper side): MAX_PRICE_MOVE_BPS is 500 and setMachine keeps rtpMax * 1.05 <= MAX_RTP_BPS, so the
    /// 94% table and the 20% guard are both refused, and the worst case (rtpMax 9047, +5%) still pays under 95%.
    function test_fixed_l01_rtpStaysUnderMaxRtpAfterAllowedMove() public {
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setMachine(M1, uint128(P1), 5000, 1_000_000, 6000, 9400);
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setGuards(2000, 0);
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setMachine(M1, uint128(P1), 5000, 1_000_000, 6000, 9048);

        _forceSingle(M1, address(nvda), 0.9047 ether); // rtpMax 9047, the highest allowed
        box.setGuards(500, 0);
        _setNvda(210e6); // +5%, the edge of the band
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("x"));
        vm.prank(alice);
        box.reveal(id);
        uint256 v = box.valueOf(address(nvda), nvda.balanceOf(alice));
        assertLe(v * 10_000 / P1, 9500, "house edge stays at least 5%");
    }

    // ------------------------------------------------------------------ L-02

    /// L-02 fixed: sealed boxes of a machine whose table went stale (operator offline) can be refunded at the
    /// price paid once the table has been stale for SEALED_REFUND_AFTER (3 days); the owner still cannot take it.
    function test_fixed_l02_sealedBoxesRefundAfterThreeStaleDays() public {
        _play(alice, M1, 5);
        uint256 shown = box.currentTable(M1) - 1;
        uint256 staleAt = box.tablePricedAt(shown) + box.maxTableAge();
        vm.warp(staleAt + 1); // operator offline: table aged out
        vm.prank(alice);
        vm.expectRevert(Arclaw.TableStale.selector);
        box.open(M1, 5, shown);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.withdraw(alice, 5 ether);

        vm.warp(staleAt + 3 days - 1);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M1, 2);
        vm.warp(staleAt + 3 days);
        uint256 a0 = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 2);
        assertEq(alice.balance - a0, 2 ether, "price paid back");
        assertEq(box.balanceOf(alice, M1), 3);
        assertEq(box.sealedReserve(), 3 ether);
        vm.prank(bob);
        vm.expectRevert(); // nothing to burn
        box.refundSealed(M1, 1);
    }

    /// L-02 fixed: same when the owner switched the machine off three days ago.
    function test_fixed_l02_sealedBoxesRefundAfterThreeDaysOff() public {
        _play(alice, M1, 5);
        box.setMachineActive(M1, false);
        assertTrue(box.machineOff(M1));
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        box.refundSealed(M1, 5);
        assertEq(box.sealedReserve(), 0);
        assertEq(box.balanceOf(alice, M1), 0);
    }

    // ------------------------------------------------------------------ L-03

    /// L-03 fixed: the opener's VRF top-up is stored per opening and paid back when the request expires: on
    /// returnBoxes, and on retry (old top-up back, new one paid). The house keeps only its own subsidy back.
    function test_fixed_l03_expiredTopUpGoesBackToTheOpener() public {
        vm.deal(address(box), 1 ether); // a house float, so the subsidy is not drawn from reserves
        vrf.setFee(0.3 ether); // subsidy 0.1: alice pays 0.2
        _play(alice, M1, 1);
        uint256 tableId = box.currentTable(M1) - 1;
        uint256 a0 = alice.balance;
        vm.prank(alice);
        (uint256 id,) = box.open{value: 0.2 ether}(M1, 1, tableId);
        assertEq(box.openingTopUp(id), 0.2 ether);
        vm.warp(block.timestamp + 61);

        vm.prank(alice);
        box.retry{value: 0.2 ether}(id); // old 0.2 back, new 0.2 paid
        assertEq(a0 - alice.balance, 0.2 ether);
        assertEq(box.openingTopUp(id), 0.2 ether);

        vm.warp(block.timestamp + 1 days); // expired again, table aged out
        uint256 free0 = box.freeBalance();
        uint256 bal0 = address(box).balance;
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(a0, alice.balance, "the top-up came back with the box");
        assertEq(box.openingTopUp(id), 0);
        assertEq(address(box).balance - bal0, 0.1 ether, "the house keeps only its own subsidy back");
        // round 4: the top-up was reserved (topUpReserve) while D20 held it, so freeBalance also gets those 0.2 back
        assertEq(box.freeBalance() - free0, 0.3 ether);
        assertEq(box.topUpReserve(), 0);
    }

    /// L-03 fixed: a keeper retry pays the opener's top-up back to the opener (the keeper tops up itself).
    function test_fixed_l03_keeperRetryRepaysTheOpener() public {
        vm.deal(address(box), 1 ether);
        vrf.setFee(0.3 ether);
        _play(alice, M1, 1);
        uint256 tableId = box.currentTable(M1) - 1;
        uint256 a0 = alice.balance;
        vm.prank(alice);
        (uint256 id,) = box.open{value: 0.2 ether}(M1, 1, tableId);
        vm.warp(block.timestamp + 61);
        box.retry{value: 0.2 ether}(id); // keeper
        assertEq(alice.balance, a0, "the top-up is back");
        assertEq(box.openingTopUp(id), 0, "the keeper's top-up is the house's own");
    }

    // ------------------------------------------------------------------ INFO

    /// INFO: any third party may retry an expired opening (paying the fee), which blocks the opener from returnBoxes
    /// until the new request expires too. Cheap griefing; it is also the house lever that limits M-01 today.
    function test_info_strangerRetryBlocksReturn() public {
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(block.timestamp + 61);
        vm.prank(bob);
        box.retry{value: 0.02 ether}(id);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.returnBoxes(id);
    }
}
