// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {MockStock} from "../../src/mocks/MockStock.sol";
import {MockPriceSource} from "../../src/mocks/MockPriceSource.sol";
import {MockVRFCoordinator} from "../../src/mocks/MockVRFCoordinator.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";
import {ArcConfig} from "../../script/Deploy.s.sol";
import {Builder} from "../MachinesJson.t.sol";
import {RejectingWallet} from "./A2Utils.sol";

/// Auditor #2 proofs of concept. Each test asserts the CURRENT (vulnerable or surprising) behaviour, so it passes
/// today and starts failing once the issue is fixed: flip the assertion when you fix it.
contract A2PoCTest is Base {
    // ------------------------------------------------------------------ helpers

    function _setPrice(address token, uint256 px) internal {
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        (t[0], p[0]) = (token, px);
        prices.setPrices(t, p);
    }

    function _single(uint256, address token, uint256 value) internal view returns (Arclaw.OutcomeInput[] memory t) {
        t = new Arclaw.OutcomeInput[](1);
        t[0] = _pack(token, 1, 0, value);
    }

    function _openFulfilReveal(address who, uint256 machineId, uint256 n, bytes32 w) internal returns (uint256 id) {
        uint256 req;
        (id, req) = _open(who, machineId, n);
        vrf.fulfill(req, w);
        box.reveal(id);
    }


    // ------------------------------------------------------------------ M-1 price change re-rates existing boxes

    /// Boxes bought at the old price open against a table built for the NEW price: the machine id does not bind
    /// the price a box was bought at. Anyone who sees the owner's reprice in the mempool (or simply holds boxes)
    /// buys at 1 USDC and opens into a 2 USDC table: 160% return, far above rtpMaxBps (80% here).
    function test_poc_M1_repriceUp_oldBoxesOpenIntoNewTable() public {
        // 1 USDC machine, deterministic 0.8x pack (rules pinned to 80%).
        _forceSingle(M1, address(nvda), 0.8 ether);
        _play(alice, M1, 10); // 10 USDC paid at the old price

        // Owner moves the machine to 2 USDC and sets a compliant table for it (0.8x of 2 = 1.6 USDC/pack).
        box.setMachine(M1, 2 ether, 3000, 1_000_000, 8000, 8000);
        box.setPrizes(M1, _single(M1, address(nvda), 1.6 ether));

        _openFulfilReveal(alice, M1, 10, keccak256("any"));
        uint256 got = nvda.balanceOf(alice) * 200e6 * 1e12 / 1e18; // USDC 18dp at $200
        assertEq(got, 16 ether, "10 boxes bought for 10 USDC pay 16 USDC of stock");
        assertGt(got * 10_000 / 10 ether, 8000, "realised RTP vs price paid is above the band");
    }

    /// The other direction: price raised, table NOT replaced ("current table keeps serving"). New buyers pay
    /// 2 USDC for packs validated against 1 USDC: 40% back, under the 50% floor the rules promise.
    function test_poc_M1_repriceUp_staleTableBreaksFloor() public {
        box.setMachine(M1, 1 ether, 5000, 100_000, 6000, 8500);
        box.setPrizes(M1, _table(address(nvda), P1)); // 0.5x (w3) / 1.5x (w1)
        box.setMachine(M1, 2 ether, 5000, 100_000, 6000, 8500);
        _play(alice, M1, 1); // pays 2 USDC
        // Find a word that draws the common outcome (0.5 USDC).
        _openFulfilReveal(alice, M1, 1, bytes32(uint256(0)));
        uint256 got = nvda.balanceOf(alice) * 200e6 * 1e12 / 1e18;
        if (got < 1 ether) {
            assertLt(got * 10_000 / 2 ether, 5000, "pack worth < floorBps of the price paid");
        }
        (uint256 rtpBps,,,) = box.tableStats(box.currentTable(M1) - 1);
        assertLt(rtpBps, 6000, "table EV now under rtpMinBps of the current price");
    }

    // ------------------------------------------------------------------ M-2 operator spend makes refunds unbacked

    /// The operator (a separate, less trusted role) can `spend` native that backs refunds and credits:
    /// spend() has no liability accounting. Here the pack token has no inventory, the operator restocks a
    /// different stock with the box revenue, and the opener's refund becomes an IOU the contract cannot pay.
    function test_poc_M2_operatorSpendLeavesCreditUnbacked() public {
        MockStock amd = new MockStock("AMD.arc"); // listed, priced, but no inventory yet
        _setPrice(address(amd), 200e6);
        _forceSingle(M1, address(amd), 0.8 ether);

        _play(alice, M1, 1); // contract holds 1 USDC
        (uint256 id, uint256 req) = _open(alice, M1, 1); // pays 0.02 VRF fee from the pool
        vm.prank(op);
        box.spend(address(desk), address(tsla), 0.9 ether, 1); // routine restock, within daily cap

        vrf.fulfill(req, keccak256("w"));
        box.reveal(id);
        assertEq(box.credit(alice), 0.8 ether);
        assertLt(address(box).balance, box.credit(alice), "credit is not backed by native balance");
        vm.prank(alice);
        vm.expectRevert(Arclaw.TransferFailed.selector);
        box.claimCredit();
    }

    // ------------------------------------------------------------------ L-1 refund pays stale value

    /// A shortfall card is refunded at its table-time value, not at the current price: with the stock down 50%
    /// the second of two identical packs (inventory covers one) pays 2x the stock's market value in native USDC.
    /// The opener controls reveal order for their own openings and sees both words before revealing.
    function test_poc_L1_shortfallRefundAtStaleValue() public {
        MockStock amd = new MockStock("AMD.arc");
        _setPrice(address(amd), 200e6);
        _forceSingle(M1, address(amd), 0.8 ether);
        Arclaw.OutcomeInput memory p = _pack(address(amd), 1, 0, 0.8 ether);
        amd.mint(address(box), p.amounts[0] + p.amounts[1] + p.amounts[2]); // inventory for exactly one pack

        _play(alice, M1, 2);
        (uint256 a, uint256 ra) = _open(alice, M1, 1);
        (uint256 b, uint256 rb) = _open(alice, M1, 1);
        vrf.fulfill(ra, keccak256("a"));
        vrf.fulfill(rb, keccak256("b"));
        _setPrice(address(amd), 100e6); // AMD halves before the reveals

        box.reveal(a); // takes the stock (now worth 0.4 USDC)
        uint256 before = alice.balance;
        box.reveal(b); // pool short: refunded at the stale 0.8 USDC
        assertEq(alice.balance - before, 0.8 ether, "refund at table-time value, 2x the market value");
    }

    // ------------------------------------------------------------------ L-2 credit stuck for native-rejecting openers

    /// claimCredit only pays msg.sender. An opener that cannot take native (smart account without receive)
    /// keeps a credit it can never withdraw: there is no claimCreditTo(address).
    function test_poc_L2_creditStuckForRejectingWallet() public {
        RejectingWallet w = new RejectingWallet();
        vm.deal(address(w), 10 ether);
        box.setPrizes(M1, _single(M1, address(nvda), 0.75 ether));
        box.sweep(address(nvda), address(1), 100 ether); // pool short: refund path
        w.call(address(box), 1 ether, abi.encodeCall(Arclaw.play, (M1, 1)));
        bytes memory ret = w.call(address(box), 0, abi.encodeCall(Arclaw.open, (M1, 1)));
        (uint256 id, uint256 req) = abi.decode(ret, (uint256, uint256));
        vrf.fulfill(req, keccak256("w"));
        box.reveal(id);
        assertEq(box.credit(address(w)), 0.75 ether);
        vm.expectRevert(Arclaw.TransferFailed.selector);
        w.call(address(box), 0, abi.encodeWithSignature("claimCredit()"));
        assertEq(box.credit(address(w)), 0.75 ether, "credit permanently stuck");
    }

    // ------------------------------------------------------------------ L-3 linkKey front-run griefing

    /// linkKey is public in the pending createLink tx. A griefer front-runs with the same key and 1 junk box:
    /// the sender's createLink reverts, and a frontend that shares the URL optimistically hands the recipient
    /// the griefer's link instead (whose boxes the key holder can claim; the griefer loses 1 box, so it is only
    /// griefing, never theft).
    function test_poc_L3_linkKeyFrontRun() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 5);
        _play(bob, M1, 1);
        address key = vm.addr(0xA11CE);
        vm.prank(bob); // front-runner
        box.createLink(key, M1, 1, uint40(block.timestamp + 1 days));
        vm.prank(alice);
        vm.expectRevert(Arclaw.LinkKeyUsed.selector);
        box.createLink(key, M1, 5, uint40(block.timestamp + 1 days));
    }

    // ------------------------------------------------------------------ M-3 knife-edge tables from machines.json

    /// machines.json puts Common exactly at floorBps (5000) and Jackpot exactly at capBps (100000). The deploy
    /// script prices the table off-chain (simulation), but _evaluate re-prices on-chain at broadcast time:
    /// a 1-unit (1e-6 USD) oracle tick on any Common-tier stock between simulation and inclusion reverts
    /// setPrizes with BelowFloor; an uptick on a Jackpot stock reverts with AboveCap. Same for every operator
    /// reprice built this way.
    function test_poc_M3_oneTickOracleMoveRevertsDeployTable() public {
        Builder bld = new Builder();
        ArcConfig.Policy memory pol = bld.policy();
        ArcConfig.MachineCfg[] memory ms = bld.machinesCfg();
        MockPriceSource ps = new MockPriceSource();
        address[8] memory tok;
        uint256[8] memory px = [uint256(214_007_697), 353_103_556, 343_420_211, 250_191_028, 710_510_964, 339_170_233, 763_695_138, 710_162_951];
        address[] memory t = new address[](8);
        uint256[] memory p = new uint256[](8);
        for (uint256 i; i < 8; ++i) {
            tok[i] = address(new MockStock("X.arc"));
            (t[i], p[i]) = (tok[i], px[i]);
        }
        ps.setPrices(t, p);
        Arclaw b2 = new Arclaw("", address(new MockVRFCoordinator()), 0.05 ether);
        b2.setPolicy(IPriceSource(address(ps)), 0);
        ArcConfig.MachineCfg memory m = ms[0];
        b2.setMachine(m.id, uint128(m.priceUsdc * 1e18), uint16(pol.floorBps), uint32(m.capBps), uint16(pol.rtpMinBps), uint16(pol.rtpMaxBps));
        Arclaw.OutcomeInput[] memory table = bld.buildFor(m, tok, px);

        // SPY (index 6) is in the Common pack: tick it down by 1e-6 USD between "simulation" and "broadcast".
        uint256 snap = vm.snapshotState();
        t = new address[](1);
        p = new uint256[](1);
        (t[0], p[0]) = (tok[6], px[6] - 1);
        ps.setPrices(t, p);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.BelowFloor.selector, 0, 4999));
        b2.setPrizes(m.id, table);

        // NVDA (index 0) leads the Jackpot pack: tick it up by 1e-6 USD.
        vm.revertToState(snap);
        (t[0], p[0]) = (tok[0], px[0] + 1);
        ps.setPrices(t, p);
        vm.expectRevert();
        b2.setPrizes(m.id, table);

        // Unmoved prices land fine.
        vm.revertToState(snap);
        b2.setPrizes(m.id, table);
    }

    // ------------------------------------------------------------------ INFO: reroll only if D20 broke its deadline rule

    /// Arclaw's "expired" == D20's "can never be fulfilled" only if D20 rejects proofs after `deadline`
    /// (API.md: accepted at timestamp <= deadline). If a late word were ever accepted, the opener who sees it in
    /// the mempool (D20: "the pending fulfillment reveals the word about one block before it lands") can
    /// front-run with returnBoxes and reopen: a free re-roll. Shown with the mock's deadline-free fulfillStarved.
    function test_poc_INFO_lateFulfilAfterReturn_isIgnored() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vm.warp(block.timestamp + 61);
        vm.prank(alice);
        box.returnBoxes(id); // opener front-runs the (hypothetical) late fulfilment
        vrf.fulfillStarved(req, keccak256("late word")); // lands after: callback reverts, ignored
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Returned));
        assertEq(box.balanceOf(alice, M1), 1, "boxes back: the late word decided nothing");
    }

    receive() external payable {}
}
