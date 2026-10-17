// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {Vm} from "forge-std/Vm.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";

contract PlayTest is Base {
    function test_play_exactPayment() public {
        _play(alice, 3);
        assertEq(box.balanceOf(alice, 0), 3);
        assertEq(address(box).balance, 3 * PRICE);
        assertEq(box.boxesSold(), 3);
    }

    function test_play_wrongPayment() public {
        vm.startPrank(alice);
        vm.expectRevert(Arclaw.WrongPayment.selector);
        box.play{value: PRICE}(2);
        vm.expectRevert(Arclaw.WrongPayment.selector);
        box.play{value: PRICE + 1}(1);
        vm.expectRevert(Arclaw.ZeroAmount.selector);
        box.play{value: 0}(0);
        vm.stopPrank();
    }

    function test_play_paused() public {
        box.pause();
        vm.prank(alice);
        vm.expectRevert();
        box.play{value: PRICE}(1);
    }

    function test_gift_batch() public {
        _play(alice, 2);
        address[] memory to = new address[](2);
        (to[0], to[1]) = (bob, makeAddr("carol"));
        vm.prank(alice);
        box.gift(to);
        assertEq(box.balanceOf(alice, 0), 0);
        assertEq(box.balanceOf(bob, 0), 1);
        assertEq(box.balanceOf(to[1], 0), 1);
    }

    function test_cannotPushBoxesIntoContract() public {
        _play(alice, 1);
        vm.prank(alice);
        vm.expectRevert(); // not an ERC1155Receiver
        box.safeTransferFrom(alice, address(box), 0, 1, "");
    }
}

contract OpenRevealTest is Base {
    function setUp() public override {
        super.setUp();
        box.setPrizes(_single(address(nvda), 0.001 ether));
    }

    function test_openFulfillReveal_paysThreeCards() public {
        _play(alice, 1);
        (uint256 id, uint256 req) = _open(alice, 1);
        assertEq(box.balanceOf(alice, 0), 0);
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Pending));

        vm.expectRevert(Arclaw.NotReady.selector);
        box.reveal(id);

        assertTrue(vrf.fulfill(req, keccak256("word")), "callback delivered within 100k gas");
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Fulfilled));

        vm.recordLogs();
        vm.prank(bob); // anyone can reveal, cards go to the opener
        box.reveal(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countEvents(logs, Arclaw.CardDrawn.selector), 3);
        assertEq(_countEvents(logs, Arclaw.Refunded.selector), 0);

        assertEq(nvda.balanceOf(alice), 0.003 ether);
        assertEq(nvda.balanceOf(bob), 0);
        assertEq(box.cardsPaid(), 3);
        assertEq(box.paidOut(address(nvda)), 0.003 ether);

        vm.expectRevert(Arclaw.NotPending.selector);
        box.reveal(id);
    }

    function test_multiBoxOpen_oneRequest() public {
        _play(alice, 5);
        uint256 nextBefore = vrf.nextId();
        (uint256 id, uint256 req) = _open(alice, 5);
        assertEq(vrf.nextId(), nextBefore + 1, "one VRF request for 5 boxes");
        vrf.fulfill(req, keccak256("w"));
        vm.recordLogs();
        box.reveal(id);
        assertEq(_countEvents(vm.getRecordedLogs(), Arclaw.CardDrawn.selector), 15);
        assertEq(nvda.balanceOf(alice), 0.015 ether);
    }

    function test_tooManyBoxes() public {
        _play(alice, 21);
        vm.prank(alice);
        vm.expectRevert(Arclaw.TooManyBoxes.selector);
        box.open(21);
    }

    function test_vrfFee_subsidisedAndTopUp() public {
        _play(alice, 2);
        uint256 balBefore = address(box).balance;
        _open(alice, 1); // fee 0.02 <= subsidy: free for the opener
        assertEq(address(box).balance, balBefore - 0.02 ether);
        assertEq(box.vrfFeesPaid(), 0.02 ether);

        vrf.setFee(0.25 ether); // spike: opener tops up 0.15, change returned
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.VrfFeeTopUp.selector, 0.15 ether, 0.1 ether));
        box.open{value: 0.1 ether}(1);

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        box.open{value: 1 ether}(1);
        assertEq(alice.balance, aliceBefore - 0.15 ether);
    }

    function test_tableFrozenAtOpen() public {
        _play(alice, 1);
        (uint256 id, uint256 req) = _open(alice, 1);
        box.setPrizes(_single(address(tsla), 5 ether)); // owner changes table after the request
        vrf.fulfill(req, keccak256("x"));
        box.reveal(id);
        assertEq(nvda.balanceOf(alice), 0.003 ether);
        assertEq(tsla.balanceOf(alice), 0);
    }

    function test_revealPausedStillWorks() public {
        _play(alice, 1);
        (uint256 id, uint256 req) = _open(alice, 1);
        box.pause();
        vrf.fulfill(req, keccak256("x"));
        box.reveal(id);
        assertEq(nvda.balanceOf(alice), 0.003 ether);
    }

    function test_failedCallback_revealReadsCoordinator() public {
        _play(alice, 1);
        (uint256 id, uint256 req) = _open(alice, 1);
        vrf.fulfillStarved(req, keccak256("starved"));
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Pending));
        box.reveal(id); // word comes from coordinator.getRequest
        assertEq(nvda.balanceOf(alice), 0.003 ether);
        vm.expectRevert(); // late redelivery of a finished request is rejected
        vm.prank(address(vrf));
        box.rawFulfillRandomness(req, keccak256("starved"));
    }

    function test_onlyCoordinatorCanFulfill() public {
        _play(alice, 1);
        (, uint256 req) = _open(alice, 1);
        vm.expectRevert();
        box.rawFulfillRandomness(req, bytes32(uint256(1)));
    }

    function testFuzz_revealAlwaysThreeCardsPerBox(bytes32 word, uint8 n) public {
        n = uint8(bound(n, 1, 20));
        Arclaw.Prize[] memory t = _bandTable();
        box.setPrizes(t);
        _play(alice, n);
        (uint256 id, uint256 req) = _open(alice, n);
        vrf.fulfill(req, word);
        box.reveal(id);
        assertEq(box.cardsPaid() + box.cardsRefunded(), uint256(n) * 3);
        assertEq(box.cardsRefunded(), 0);
    }
}

contract ShortfallTest is Base {
    function test_shortfall_refundsPerCard() public {
        // Inventory covers exactly one card of 40 NVDA.
        box.setPrizes(_single(address(nvda), 40 ether));
        vm.prank(address(box));
        nvda.transfer(address(1), 60 ether); // leave 40 in the pool
        _play(alice, 1);
        (uint256 id, uint256 req) = _open(alice, 1);
        vrf.fulfill(req, keccak256("w"));
        uint256 before = alice.balance;
        vm.recordLogs();
        box.reveal(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countEvents(logs, Arclaw.CardDrawn.selector), 3);
        assertEq(_countEvents(logs, Arclaw.Refunded.selector), 2);
        assertEq(nvda.balanceOf(alice), 40 ether);
        assertEq(alice.balance, before + 2 * (PRICE / 3));
        assertEq(box.cardsRefunded(), 2);
    }

    function test_shortfall_refundUsesPriceAtOpen() public {
        box.setPrizes(_single(address(nvda), 1000 ether)); // never covered
        _play(alice, 1);
        (uint256 id, uint256 req) = _open(alice, 1);
        box.setBoxPrice(5 ether); // repricing after the open does not change the refund
        vm.deal(address(box), 10 ether);
        vrf.fulfill(req, keccak256("w"));
        uint256 before = alice.balance;
        box.reveal(id);
        assertEq(alice.balance, before + 3 * (PRICE / 3));
    }

    function test_shortfall_underfundedRefundBecomesCredit() public {
        box.setPrizes(_single(address(nvda), 1000 ether)); // never covered
        _play(alice, 1); // 1 USDC in, 0.02 VRF fee out: 0.98 left, 0.999.. owed
        (uint256 id, uint256 req) = _open(alice, 1);
        vrf.fulfill(req, keccak256("w"));
        box.reveal(id); // never blocked
        assertEq(box.credit(alice), 3 * (PRICE / 3));
        vm.deal(address(box), 5 ether); // treasury tops up
        uint256 before = alice.balance;
        vm.prank(alice);
        box.claimCredit();
        assertEq(alice.balance, before + 3 * (PRICE / 3));
        assertEq(box.credit(alice), 0);
    }
}

contract PolicyTest is Base {
    function test_payoutBps_threeCards() public view {
        assertEq(box.payoutBps(_bandTable()), 7500);
    }

    function test_operatorSetPrizes_inBand() public {
        vm.prank(op);
        box.operatorSetPrizes(_bandTable());
        assertEq(box.tableCount(), 1);
        assertEq(box.totalWeight(), 4);
    }

    function test_operatorSetPrizes_belowAndAboveBand() public {
        Arclaw.Prize[] memory t = _bandTable();
        t[0].amount = t[0].amount / 2; // ~ 0.125*3*.75 + .25*3*.25 = 4687 bps
        uint256 low = box.payoutBps(t);
        assertLt(low, 7000);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.PayoutOutOfBand.selector, low));
        box.operatorSetPrizes(t);

        t = _bandTable();
        t[1].amount = t[1].amount * 3; // 0.25*3*.75 + .75*3*.25 = 1.125 -> 11250 bps
        uint256 bps = box.payoutBps(t);
        assertGt(bps, 8000);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.PayoutOutOfBand.selector, bps));
        box.operatorSetPrizes(t);
    }

    function test_operatorOnly() public {
        Arclaw.Prize[] memory t = _bandTable();
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotOperator.selector);
        box.operatorSetPrizes(t);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotOperator.selector);
        box.spend(address(desk), address(nvda), 1 ether, 1);
    }

    function test_ownerOnly() public {
        Arclaw.Prize[] memory t = _bandTable();
        address src = address(box.priceSource());
        vm.startPrank(alice);
        vm.expectRevert();
        box.setPrizes(t);
        vm.expectRevert();
        box.withdraw(alice, 1);
        vm.expectRevert();
        box.setPolicy(IPriceSource(src), 0, 10_000, type(uint256).max);
        vm.stopPrank();
        vm.expectRevert(Arclaw.RenounceDisabled.selector);
        box.renounceOwnership();
    }

    function test_badPrizeRejected() public {
        Arclaw.Prize[] memory t = _single(address(0), 1);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.BadPrize.selector, 0));
        box.setPrizes(t);
        t = _single(address(nvda), 0);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.BadPrize.selector, 0));
        box.setPrizes(t);
    }

    function test_spend_buysIntoContract() public {
        _play(alice, 10);
        uint256 before = nvda.balanceOf(address(box));
        vm.prank(op);
        uint256 got = box.spend(address(desk), address(nvda), 2 ether, 0.01 ether);
        assertEq(got, 0.01 ether); // $2 at $200
        assertEq(nvda.balanceOf(address(box)), before + got);
        assertEq(box.spentToday(), 2 ether);
    }

    function test_spend_allowlistCapSlippage() public {
        vm.deal(address(box), 100 ether);
        vm.startPrank(op);
        vm.expectRevert(Arclaw.NotSink.selector);
        box.spend(alice, address(nvda), 1 ether, 1);

        vm.expectRevert(); // desk reverts Slippage
        box.spend(address(desk), address(nvda), 1 ether, 1 ether);

        box.spend(address(desk), address(nvda), 30 ether, 1);
        vm.expectRevert(Arclaw.OverDailyCap.selector);
        box.spend(address(desk), address(nvda), 20 ether + 1, 1);
        box.spend(address(desk), address(nvda), 20 ether, 1);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days); // new UTC day resets the cap
        vm.prank(op);
        box.spend(address(desk), address(nvda), 50 ether, 1);
    }

    function test_withdrawAndSweep() public {
        _play(alice, 2);
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
        box.setPrizes(_single(address(nvda), 0.001 ether));
        _play(alice, 2);
    }

    function test_retry_afterExpiry() public {
        (uint256 id, uint256 req) = _open(alice, 2);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.retry(id);

        vm.warp(block.timestamp + 61);
        vm.expectRevert(); // coordinator refuses a late proof
        vrf.fulfill(req, keccak256("late"));

        vm.prank(bob); // anyone can re-request
        uint256 req2 = box.retry(id);
        assertTrue(req2 != req);
        assertEq(box.openingOfRequest(req), 0);

        // the expired fee comes back to the contract
        uint256 bal = address(box).balance;
        vrf.refundRequest(req);
        assertEq(address(box).balance, bal + 0.02 ether);

        vrf.fulfill(req2, keccak256("w"));
        box.reveal(id);
        assertEq(nvda.balanceOf(alice), 0.006 ether);
    }

    function test_retry_refusedOnceFulfilled() public {
        (uint256 id, uint256 req) = _open(alice, 1);
        vrf.fulfillStarved(req, keccak256("w")); // accepted, callback failed
        vm.warp(block.timestamp + 120);
        vm.expectRevert(Arclaw.AlreadyFulfilled.selector);
        box.retry(id); // no re-roll of a known word
        vm.prank(alice);
        vm.expectRevert(Arclaw.AlreadyFulfilled.selector);
        box.returnBoxes(id);
        box.reveal(id);
        assertEq(nvda.balanceOf(alice), 0.003 ether);
    }

    function test_returnBoxes_afterExpiry() public {
        (uint256 id,) = _open(alice, 2);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.returnBoxes(id);
        vm.warp(block.timestamp + 61);
        vm.prank(bob);
        vm.expectRevert(Arclaw.NotOpener.selector);
        box.returnBoxes(id);
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.balanceOf(alice, 0), 2);
        assertEq(box.boxesOpened(), 0);
        vm.expectRevert(Arclaw.NotPending.selector);
        box.reveal(id);
        vm.expectRevert(Arclaw.NotPending.selector);
        box.retry(id);
    }
}
