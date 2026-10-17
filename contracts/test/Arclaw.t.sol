// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {Vm} from "forge-std/Vm.sol";

contract PlayTest is Base {
    function test_play_exactPayment_perMachine() public {
        _play(alice, M1, 3);
        _play(alice, M2, 2);
        assertEq(box.balanceOf(alice, M1), 3);
        assertEq(box.balanceOf(alice, M2), 2);
        assertEq(address(box).balance, 3 * P1 + 2 * P2);
        assertEq(box.boxesSold(M1), 3);
        assertEq(box.boxesSold(M2), 2);
    }

    function test_play_wrongPayment() public {
        vm.startPrank(alice);
        vm.expectRevert(Arclaw.WrongPayment.selector);
        box.play{value: P1}(M1, 2);
        vm.expectRevert(Arclaw.WrongPayment.selector);
        box.play{value: P1}(M2, 1); // $1 into the $5 machine
        vm.expectRevert(Arclaw.ZeroAmount.selector);
        box.play{value: 0}(M1, 0);
        vm.expectRevert(Arclaw.UnknownMachine.selector);
        box.play{value: P1}(9, 1);
        vm.stopPrank();
    }

    function test_play_paused() public {
        box.pause();
        vm.prank(alice);
        vm.expectRevert();
        box.play{value: P1}(M1, 1);
    }

    function test_gift_batch() public {
        _play(alice, M2, 2);
        address[] memory to = new address[](2);
        (to[0], to[1]) = (bob, makeAddr("carol"));
        vm.prank(alice);
        box.gift(M2, to);
        assertEq(box.balanceOf(alice, M2), 0);
        assertEq(box.balanceOf(bob, M2), 1);
        assertEq(box.balanceOf(to[1], M2), 1);
    }

    function test_cannotPushBoxesIntoContract() public {
        _play(alice, M1, 1);
        vm.prank(alice);
        vm.expectRevert(); // not an ERC1155Receiver
        box.safeTransferFrom(alice, address(box), M1, 1, "");
    }
}

contract OpenRevealTest is Base {
    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setPrizes(M2, _table(address(tsla), P2));
    }

    function test_openFulfillReveal_paysOnePackOfThree() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        assertEq(box.balanceOf(alice, M1), 0);
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Pending));

        vm.expectRevert(Arclaw.NotReady.selector);
        box.reveal(id);

        assertTrue(vrf.fulfill(req, keccak256("word")), "callback delivered within 100k gas");
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Fulfilled));

        vm.recordLogs();
        vm.prank(bob); // anyone can reveal, cards go to the opener
        box.reveal(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countEvents(logs, Arclaw.OutcomeDrawn.selector), 1);
        assertEq(_countEvents(logs, Arclaw.CardDrawn.selector), 3);
        assertEq(_countEvents(logs, Arclaw.Refunded.selector), 0);

        uint256 got = nvda.balanceOf(alice);
        assertTrue(got == 0.0025 ether || got == 0.0075 ether, "one whole pack: 0.5x or 1.5x");
        assertEq(nvda.balanceOf(bob), 0);
        assertEq(box.cardsPaid(), 3);

        vm.expectRevert(Arclaw.NotPending.selector);
        box.reveal(id);
    }

    function test_machinesDrawFromTheirOwnTables() public {
        _play(alice, M1, 1);
        _play(alice, M2, 1);
        (uint256 a, uint256 ra) = _open(alice, M1, 1);
        (uint256 b, uint256 rb) = _open(alice, M2, 1);
        vrf.fulfill(ra, keccak256("a"));
        vrf.fulfill(rb, keccak256("b"));
        box.reveal(a);
        assertGt(nvda.balanceOf(alice), 0);
        assertEq(tsla.balanceOf(alice), 0);
        box.reveal(b);
        uint256 t = tsla.balanceOf(alice); // $5 machine: 2.5 or 7.5 USDC of TSLA at $400
        assertTrue(t == 0.00625 ether || t == 0.01875 ether);
    }

    function test_outcomeDrawnEvent() public {
        _play(alice, M2, 1);
        (uint256 id, uint256 req) = _open(alice, M2, 1);
        vrf.fulfill(req, keccak256("e"));
        vm.recordLogs();
        box.reveal(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != Arclaw.OutcomeDrawn.selector) continue;
            assertEq(uint256(logs[i].topics[1]), id);
            assertEq(uint256(logs[i].topics[2]), M2);
            (uint256 boxIndex, uint256 tier,, uint256 value) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
            assertEq(boxIndex, 0);
            assertEq(value, tier == 0 ? P2 / 2 : P2 * 3 / 2);
        }
    }

    function test_multiBoxOpen_oneRequest() public {
        _play(alice, M1, 5);
        uint256 nextBefore = vrf.nextId();
        (uint256 id, uint256 req) = _open(alice, M1, 5);
        assertEq(vrf.nextId(), nextBefore + 1, "one VRF request for 5 boxes");
        vrf.fulfill(req, keccak256("w"));
        vm.recordLogs();
        box.reveal(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countEvents(logs, Arclaw.OutcomeDrawn.selector), 5);
        assertEq(_countEvents(logs, Arclaw.CardDrawn.selector), 15);
    }

    function test_distribution_matchesWeights() public {
        // 3:1 table; 400 boxes over 20 openings, ~300 common expected.
        uint256 commons;
        for (uint256 r; r < 20; ++r) {
            _play(alice, M1, 20);
            (uint256 id, uint256 req) = _open(alice, M1, 20);
            vrf.fulfill(req, keccak256(abi.encode("dist", r)));
            vm.recordLogs();
            box.reveal(id);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            for (uint256 i; i < logs.length; ++i) {
                if (logs[i].topics[0] != Arclaw.OutcomeDrawn.selector) continue;
                (, uint256 tier,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                if (tier == 0) ++commons;
            }
        }
        assertGt(commons, 270);
        assertLt(commons, 330);
    }

    function test_tooManyBoxes() public {
        _play(alice, M1, 21);
        vm.prank(alice);
        vm.expectRevert(Arclaw.TooManyBoxes.selector);
        box.open(M1, 21);
    }

    function test_open_needsTable() public {
        box.setMachine(3, uint128(10 ether), 5000, 100_000, 6000, 8500);
        vm.deal(alice, 100 ether);
        _play(alice, 3, 1);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NoPrizes.selector);
        box.open(3, 1);
    }

    function test_vrfFee_subsidisedAndTopUp() public {
        _play(alice, M1, 2);
        uint256 balBefore = address(box).balance;
        _open(alice, M1, 1);
        assertEq(address(box).balance, balBefore - 0.02 ether);
        assertEq(box.vrfFeesPaid(), 0.02 ether);

        vrf.setFee(0.25 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.VrfFeeTopUp.selector, 0.15 ether, 0.1 ether));
        box.open{value: 0.1 ether}(M1, 1);

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        box.open{value: 1 ether}(M1, 1);
        assertEq(alice.balance, aliceBefore - 0.15 ether);
    }

    function test_tableFrozenAtOpen() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        box.setPrizes(M1, _table(address(tsla), P1)); // changed after the request
        vrf.fulfill(req, keccak256("x"));
        box.reveal(id);
        assertGt(nvda.balanceOf(alice), 0);
        assertEq(tsla.balanceOf(alice), 0);
    }

    function test_revealPausedStillWorks() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        box.pause();
        vrf.fulfill(req, keccak256("x"));
        box.reveal(id);
        assertGt(nvda.balanceOf(alice), 0);
    }

    function test_failedCallback_revealReadsCoordinator() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfillStarved(req, keccak256("starved"));
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Pending));
        box.reveal(id);
        assertGt(nvda.balanceOf(alice), 0);
        vm.prank(address(vrf));
        vm.expectRevert(Arclaw.UnexpectedCallback.selector);
        box.rawFulfillRandomness(req, keccak256("starved"));
    }

    function test_onlyCoordinatorCanFulfill() public {
        _play(alice, M1, 1);
        (, uint256 req) = _open(alice, M1, 1);
        vm.expectRevert();
        box.rawFulfillRandomness(req, bytes32(uint256(1)));
    }

    function testFuzz_revealAlwaysThreeCardsPerBox(bytes32 word, uint8 n, bool big) public {
        n = uint8(bound(n, 1, 20));
        uint256 m = big ? M2 : M1;
        _play(alice, m, n);
        (uint256 id, uint256 req) = _open(alice, m, n);
        vrf.fulfill(req, word);
        box.reveal(id);
        assertEq(box.cardsPaid() + box.cardsRefunded(), uint256(n) * 3);
        assertEq(box.cardsRefunded(), 0);
    }
}

contract ShortfallTest is Base {
    function test_shortfall_refundsThatCardsValue() public {
        _forceSingle(M1, address(nvda), 0.75 ether); // cards 0.30 / 0.30 / 0.15 USDC of NVDA
        // Leave inventory for exactly the first card (0.0015 NVDA).
        box.sweep(address(nvda), address(1), 100 ether - 0.0015 ether);
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        uint256 before = alice.balance;
        vm.recordLogs();
        box.reveal(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countEvents(logs, Arclaw.CardDrawn.selector), 3);
        assertEq(_countEvents(logs, Arclaw.Refunded.selector), 2);
        assertEq(nvda.balanceOf(alice), 0.0015 ether);
        assertEq(alice.balance, before + 0.30 ether + 0.15 ether, "refund = the missing cards' values");
        assertEq(box.cardsRefunded(), 2);
    }

    function _setNvda(uint256 px) internal {
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        (t[0], p[0]) = (address(nvda), px);
        prices.setPrices(t, p);
    }

    function test_shortfall_refundCappedAtTableValue() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.sweep(address(nvda), address(1), 100 ether); // nothing left
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        _setNvda(400e6); // NVDA doubles after the open: refund stays at the table value
        vrf.fulfill(req, keccak256("w"));
        uint256 before = alice.balance;
        box.reveal(id);
        assertEq(alice.balance, before + 0.75 ether);
    }

    function test_shortfall_refundFollowsPriceDown() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.sweep(address(nvda), address(1), 100 ether);
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        _setNvda(100e6); // NVDA halves: refund is the current value, 0.375
        vrf.fulfill(req, keccak256("w"));
        uint256 before = alice.balance;
        box.reveal(id);
        assertEq(alice.balance, before + 0.375 ether);
    }

    function test_shortfall_oracleDownFallsBackToTableValue() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.sweep(address(nvda), address(1), 100 ether);
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        _setNvda(0); // price source now reverts (Unpriced)
        vrf.fulfill(req, keccak256("w"));
        uint256 before = alice.balance;
        box.reveal(id); // never blocked
        assertEq(alice.balance, before + 0.75 ether);
    }

    function test_shortfall_underfundedRefundBecomesCredit() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.sweep(address(nvda), address(1), 100 ether);
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vm.deal(address(box), 0.5 ether); // pool holds less than the refund (withdraw cannot do this any more)
        vrf.fulfill(req, keccak256("w"));
        box.reveal(id); // never blocked
        assertEq(box.credit(alice), 0.75 ether);
        vm.deal(address(box), 5 ether);
        uint256 before = alice.balance;
        vm.prank(alice);
        box.claimCredit();
        assertEq(alice.balance, before + 0.75 ether);
        assertEq(box.credit(alice), 0);
    }

    receive() external payable {}
}

contract RulesTest is Base {
    function test_table_inBand() public {
        Arclaw.OutcomeInput[] memory t = _table(address(nvda), P1);
        vm.prank(op);
        box.operatorSetPrizes(M1, t);
        uint256 tid = box.currentTable(M1) - 1;
        (uint256 rtp, uint256 minBps, uint256 maxBps, uint256 w) = lens.stats(box, M1);
        assertEq(rtp, 7500);
        assertEq(minBps, 5000);
        assertEq(maxBps, 15_000);
        assertEq(w, 4);
        assertEq(box.outcomes(M1).length, 2);
        assertEq(box.outcomes(M1)[1].cards[0].value, 0.6 ether);
    }

    function test_floorRejected() public {
        Arclaw.OutcomeInput[] memory t = _table(address(nvda), P1);
        t[0] = _pack(address(nvda), 3, 0, 0.49 ether); // 4900 bps < 5000 floor
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.BelowFloor.selector, 0, 4900));
        box.operatorSetPrizes(M1, t);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.BelowFloor.selector, 0, 4900));
        box.setPrizes(M1, t); // the owner is bound too
    }

    function test_capRejected() public {
        Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](3);
        t[0] = _pack(address(nvda), 1000, 0, 0.5 ether);
        t[1] = _pack(address(nvda), 300, 1, 1 ether);
        t[2] = _pack(address(nvda), 1, 2, 10.2 ether); // 10.2x > 10x cap
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.AboveCap.selector, 2, 102_000));
        box.operatorSetPrizes(M1, t);
        t[2] = _pack(address(nvda), 1, 2, 10 ether); // exactly at the cap lands
        vm.prank(op);
        box.operatorSetPrizes(M1, t);
    }

    function test_rtpBandRejected() public {
        Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](1);
        t[0] = _pack(address(nvda), 1, 0, 0.5 ether); // RTP 50% < 60%
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.RtpOutOfBand.selector, 5000));
        box.operatorSetPrizes(M1, t);

        t = _table(address(nvda), P1);
        t[1].weight = 2; // (1.5 + 3) / 5 = 0.9 > 0.85
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.RtpOutOfBand.selector, 9000));
        box.operatorSetPrizes(M1, t);
    }

    function test_rulesAreOwnerSettableAndBounded() public {
        vm.expectEmit(true, false, false, true);
        emit Arclaw.MachineSet(M1, P1, 5000, 50_000, 7000, 8000);
        box.setMachine(M1, uint128(P1), 5000, 50_000, 7000, 8000);
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setMachine(M1, uint128(P1), 2999, 100_000, 6000, 8500); // floor under 30%
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setMachine(M1, uint128(P1), 5000, 100_000, 6000, 9501); // RTP over 95%
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setMachine(M1, uint128(P1), 6000, 100_000, 5500, 8500); // floor above rtpMin
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setMachine(M1, uint128(P1), 5000, 1_000_001, 6000, 8500); // cap over 100x
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setMachine(0, uint128(P1), 5000, 100_000, 6000, 8500);
        vm.prank(alice);
        vm.expectRevert();
        box.setMachine(M1, uint128(P1), 5000, 100_000, 6000, 8500);
        assertEq(box.machineIds().length, 2);
    }

    function test_priceImmutable_newPriceIsNewMachine() public {
        vm.expectRevert(Arclaw.PriceImmutable.selector);
        box.setMachine(M1, uint128(2 ether), 5000, 100_000, 6000, 8500);
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setMachine(4, 0, 5000, 100_000, 6000, 8500); // no free machines
        box.setMachine(M1, uint128(P1), 5000, 50_000, 6500, 8000); // rules still tunable
        box.setMachine(4, uint128(2 ether), 5000, 100_000, 6000, 8500); // the new price lives on a new id
        assertEq(box.machineIds().length, 3);
    }

    function test_machineToggle() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 2);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        box.setMachineActive(M1, false);
        vm.prank(alice);
        vm.expectRevert(Arclaw.MachineOff.selector);
        box.play{value: P1}(M1, 1);
        vm.prank(alice);
        vm.expectRevert(Arclaw.MachineOff.selector);
        box.open(M1, 1);
        vrf.fulfill(req, keccak256("w"));
        box.reveal(id); // pending openings still pay
        box.setMachineActive(M1, true);
        _open(alice, M1, 1);
        vm.expectRevert(Arclaw.UnknownMachine.selector);
        box.setMachineActive(9, true);
    }

    function test_tablePriceRecorded() public {
        box.setPrizes(M2, _table(address(tsla), P2));
        assertEq(box.tablePrice(box.currentTable(M2) - 1), P2);
    }

    function test_reserve_creditAndPendingAreUntouchable() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.sweep(address(nvda), address(1), 100 ether); // every card refunds
        _play(alice, M1, 2);
        (uint256 id, uint256 req) = _open(alice, M1, 2);
        assertEq(box.pendingReserve(), 2 * P1);
        // 2 USDC in, 0.02 fee out: 1.98 held against 2.00 pending -> nothing free
        assertEq(box.freeBalance(), 0);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.withdraw(address(this), 1);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.spend(address(desk), address(tsla), 1 ether, 1);

        vm.deal(address(box), 1 ether); // pool smaller than the 1.5 refund owed: it becomes credit
        vrf.fulfill(req, keccak256("w"));
        box.reveal(id);
        assertEq(box.pendingReserve(), 0);
        assertEq(box.credit(alice), 1.5 ether);
        assertEq(box.reservedCredit(), 1.5 ether);
        vm.deal(address(box), 4 ether); // treasury top-up
        assertEq(box.freeBalance(), 2.5 ether);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 2.5 ether));
        box.withdraw(address(this), 2.5 ether + 1);
        box.withdraw(address(this), 2.5 ether);

        address to = makeAddr("alice-eoa");
        vm.prank(alice);
        box.claimCredit(to); // pay elsewhere
        assertEq(to.balance, 1.5 ether);
        assertEq(box.reservedCredit(), 0);
    }

    function test_reserve_releasedOnReturn() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 3);
        (uint256 id,) = _open(alice, M1, 3);
        assertEq(box.pendingReserve(), 3 * P1);
        vm.warp(block.timestamp + 61);
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.pendingReserve(), 0);
    }

    receive() external payable {}

    function test_staleTableRefusesOpen() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        uint256 pricedAt = box.tablePricedAt(box.currentTable(M1) - 1);
        assertEq(pricedAt, block.timestamp);
        _play(alice, M1, 2);
        vm.warp(block.timestamp + 1 days); // exactly maxTableAge: still fine
        _open(alice, M1, 1);
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        vm.expectRevert(Arclaw.TableStale.selector);
        box.open(M1, 1);
        Arclaw.OutcomeInput[] memory fresh = _table(address(nvda), P1);
        vm.prank(op);
        box.operatorSetPrizes(M1, fresh); // keeper reprices
        _open(alice, M1, 1);
    }

    function test_maxTableAgeOwnerSet() public {
        vm.expectEmit(false, false, false, true);
        emit Arclaw.MaxTableAgeSet(6 hours);
        box.setMaxTableAge(6 hours);
        assertEq(box.maxTableAge(), 6 hours);
        vm.expectRevert(Arclaw.BadMachine.selector);
        box.setMaxTableAge(0);
        vm.prank(alice);
        vm.expectRevert();
        box.setMaxTableAge(1 days);
    }

    function test_maxOutcomes() public {
        box.setMachine(M1, uint128(P1), 5000, 100_000, 7500, 7500);
        Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](65);
        for (uint256 i; i < 65; ++i) t[i] = _pack(address(nvda), 1, 0, 0.75 ether);
        vm.expectRevert(Arclaw.TooManyOutcomes.selector);
        box.setPrizes(M1, t);
        assembly { mstore(t, 64) } // the limit itself lands
        box.setPrizes(M1, t);
        assertEq(box.outcomes(M1).length, 64);
    }

    function test_operatorOnly() public {
        Arclaw.OutcomeInput[] memory t = _table(address(nvda), P1);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotOperator.selector);
        box.operatorSetPrizes(M1, t);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotOperator.selector);
        box.spend(address(desk), address(nvda), 1 ether, 1);
    }

    function test_ownerOnly() public {
        Arclaw.OutcomeInput[] memory t = _table(address(nvda), P1);
        address src = address(box.priceSource());
        vm.startPrank(alice);
        vm.expectRevert();
        box.setPrizes(M1, t);
        vm.expectRevert();
        box.withdraw(alice, 1);
        vm.expectRevert();
        box.setPolicy(IPriceSource(src), type(uint256).max);
        vm.stopPrank();
        vm.expectRevert(Arclaw.RenounceDisabled.selector);
        box.renounceOwnership();
    }

    function test_badPrizeRejected() public {
        Arclaw.OutcomeInput[] memory t = _table(address(nvda), P1);
        t[1].tokens[2] = address(0);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.BadPrize.selector, 1));
        box.setPrizes(M1, t);
        t = _table(address(nvda), P1);
        t[0].weight = 0;
        vm.expectRevert(abi.encodeWithSelector(Arclaw.BadPrize.selector, 0));
        box.setPrizes(M1, t);
        vm.expectRevert(Arclaw.UnknownMachine.selector);
        box.setPrizes(7, t);
    }

    function test_spend_buysIntoContract() public {
        _play(alice, M1, 10);
        uint256 before = nvda.balanceOf(address(box));
        vm.prank(op);
        uint256 got = box.spend(address(desk), address(nvda), 2 ether, 0.01 ether);
        assertEq(got, 0.01 ether);
        assertEq(nvda.balanceOf(address(box)), before + got);
        assertEq(box.spentToday(), 2 ether);
    }

    function test_spend_allowlistCapSlippage() public {
        vm.deal(address(box), 100 ether);
        vm.startPrank(op);
        vm.expectRevert(Arclaw.NotSink.selector);
        box.spend(alice, address(nvda), 1 ether, 1);
        vm.expectRevert();
        box.spend(address(desk), address(nvda), 1 ether, 1 ether);
        box.spend(address(desk), address(nvda), 30 ether, 1);
        vm.expectRevert(Arclaw.OverDailyCap.selector);
        box.spend(address(desk), address(nvda), 20 ether + 1, 1);
        box.spend(address(desk), address(nvda), 20 ether, 1);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        vm.prank(op);
        box.spend(address(desk), address(nvda), 50 ether, 1);
    }

    function test_withdrawAndSweep() public {
        _play(alice, M2, 1);
        box.withdraw(bob, 1 ether);
        assertEq(bob.balance, 1001 ether);
        box.sweep(address(nvda), bob, 1 ether);
        assertEq(nvda.balanceOf(bob), 1 ether);
    }

    function test_twoStepOwnership() public {
        box.transferOwnership(alice);
        assertEq(box.owner(), address(this));
        vm.prank(alice);
        box.acceptOwnership();
        assertEq(box.owner(), alice);
    }
}

contract StuckVrfTest is Base {
    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 2);
    }

    function test_retry_afterExpiry() public {
        (uint256 id, uint256 req) = _open(alice, M1, 2);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.retry(id);

        vm.warp(block.timestamp + 61);
        vm.expectRevert();
        vrf.fulfill(req, keccak256("late"));

        uint256 bal = address(box).balance;
        vm.prank(bob); // a stranger pays the whole fee
        vm.expectRevert(abi.encodeWithSelector(Arclaw.VrfFeeTopUp.selector, 0.02 ether, 0));
        box.retry(id);
        vm.prank(bob);
        uint256 req2 = box.retry{value: 0.02 ether}(id);
        assertTrue(req2 != req);
        assertEq(box.openingOfRequest(req), 0);
        // old fee reclaimed (+0.02) and the stranger paid the new one: the house is up 0.02
        assertEq(address(box).balance, bal + 0.02 ether);
        vm.expectRevert(); // already refunded by retry
        vrf.refundRequest(req);

        vrf.fulfill(req2, keccak256("w"));
        box.reveal(id);
        assertEq(box.cardsPaid(), 6);
    }

    function test_retry_openerFreeAndBalanceNeutral() public {
        uint256 t0 = block.timestamp;
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(t0 + 61);
        uint256 bal = address(box).balance;
        vm.prank(alice);
        box.retry(id); // old fee back in, new fee out
        assertEq(address(box).balance, bal);
        vm.warp(t0 + 122);
        vm.prank(op);
        box.retry(id); // the operator's keeper retries free too
        assertEq(address(box).balance, bal);
    }

    function test_returnBoxes_reclaimsFee() public {
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vm.warp(block.timestamp + 61);
        uint256 bal = address(box).balance;
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(address(box).balance, bal + 0.02 ether);
        vm.expectRevert();
        vrf.refundRequest(req);
    }

    function test_retry_refusedOnceFulfilled() public {
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfillStarved(req, keccak256("w"));
        vm.warp(block.timestamp + 120);
        vm.expectRevert(Arclaw.AlreadyFulfilled.selector);
        box.retry(id);
        vm.prank(alice);
        vm.expectRevert(Arclaw.AlreadyFulfilled.selector);
        box.returnBoxes(id);
        box.reveal(id);
        assertEq(box.cardsPaid(), 3);
    }

    function test_returnBoxes_afterExpiry() public {
        (uint256 id,) = _open(alice, M1, 2);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.returnBoxes(id);
        vm.warp(block.timestamp + 61);
        vm.prank(bob);
        vm.expectRevert(Arclaw.NotOpener.selector);
        box.returnBoxes(id);
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.balanceOf(alice, M1), 2);
        assertEq(box.boxesOpened(), 0);
        vm.expectRevert(Arclaw.NotPending.selector);
        box.reveal(id);
        vm.expectRevert(Arclaw.NotPending.selector);
        box.retry(id);
    }
}
