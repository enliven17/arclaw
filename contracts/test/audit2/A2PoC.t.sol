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

/// Auditor #2 proofs of concept, flipped after the fix pass: each test_fixed_* asserts the FIXED behaviour.
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

    /// M-1 fixed: the price is immutable, so boxes bought at 1 USDC can never open into a 2 USDC table.
    function test_fixed_M1_repriceUpReverts() public {
        _forceSingle(M1, address(nvda), 0.8 ether);
        _play(alice, M1, 10);
        vm.expectRevert(Arclaw.PriceImmutable.selector);
        box.setMachine(M1, 2 ether, 3000, 1_000_000, 8000, 8000);
        _openFulfilReveal(alice, M1, 10, keccak256("any"));
        uint256 got = nvda.balanceOf(alice) * 200e6 * 1e12 / 1e18;
        assertEq(got, 8 ether, "10 boxes at 1 USDC pay 0.8 each, inside the band");
    }

    /// M-1 fixed (other direction): a raise is impossible, and every table records the price it was validated
    /// against (open() refuses a mismatch), so a table can never serve a price it was not checked for.
    function test_fixed_M1_staleTableCannotServeNewPrice() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        vm.expectRevert(Arclaw.PriceImmutable.selector);
        box.setMachine(M1, 2 ether, 5000, 100_000, 6000, 8500);
        assertEq(box.tablePrice(box.currentTable(M1) - 1), P1);
        (uint256 rtpBps,,,) = lens.stats(box, M1);
        assertEq(rtpBps, 7500);
    }

    // ------------------------------------------------------------------ M-2 operator spend makes refunds unbacked

    /// M-2 fixed: spend() only touches the free balance. The pending box's price is reserved, so the routine restock
    /// reverts and the refund is paid in full.
    function test_fixed_M2_operatorSpendCannotTouchReserve() public {
        MockStock amd = new MockStock("AMD.arc"); // listed, priced, but no inventory yet
        _setPrice(address(amd), 200e6);
        _forceSingle(M1, address(amd), 0.8 ether);

        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.spend(address(desk), address(tsla), 0.9 ether, 1);

        vrf.fulfill(req, keccak256("w"));
        uint256 before = alice.balance;
        box.reveal(id);
        assertEq(alice.balance - before, 0.8 ether);
        assertEq(box.credit(alice), 0);
    }

    // ------------------------------------------------------------------ L-1 refund pays stale value

    /// L-1 fixed: a short card refunds min(table-time value, current value). With the stock down 50% the refund is
    /// the market value, so holding a pack across a crash and racing reveals gains nothing.
    function test_fixed_L1_refundAtMinOfTableAndMarket() public {
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

        box.reveal(a);
        uint256 before = alice.balance;
        box.reveal(b);
        assertEq(alice.balance - before, 0.4 ether, "refund at the current market value");
    }

    // ------------------------------------------------------------------ L-2 credit stuck for native-rejecting openers

    /// L-2 fixed: claimCredit(address to) lets a wallet that cannot take native USDC route its credit elsewhere.
    function test_fixed_L2_creditClaimableToAnotherAddress() public {
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
        address eoa = makeAddr("owner eoa");
        w.call(address(box), 0, abi.encodeWithSignature("claimCredit(address)", eoa));
        assertEq(eoa.balance, 0.75 ether);
        assertEq(box.credit(address(w)), 0);
        assertEq(box.reservedCredit(), 0);
    }

    // ------------------------------------------------------------------ L-3 linkKey front-run griefing

    /// L-3 (mitigated off-chain): a front-run with the same linkKey makes the honest createLink revert, so a frontend
    /// that shares the link only after its createLink is confirmed (see lib/abi/arclaw.ts) never hands out the
    /// griefer's link. The griefer only loses a box to the key holder.
    function test_fixed_L3_frontRunMakesHonestCreateRevert() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 5);
        _play(bob, M1, 1);
        address key = vm.addr(0xA11CE);
        vm.prank(bob); // front-runner
        box.createLink(key, M1, 1, uint40(block.timestamp + 1 days));
        vm.prank(alice);
        vm.expectRevert(Arclaw.LinkKeyUsed.selector);
        box.createLink(key, M1, 5, uint40(block.timestamp + 1 days));
        assertEq(box.balanceOf(alice, M1), 5, "honest sender keeps every box");
    }

    // ------------------------------------------------------------------ M-3 knife-edge tables from machines.json

    /// M-3 fixed: the builder leaves 1% of slack at the floor and the cap, so a 1-tick oracle move between the
    /// off-chain build and inclusion no longer reverts setPrizes.
    function test_fixed_M3_oneTickOracleMoveStillLands() public {
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

        uint256 snap = vm.snapshotState();
        t = new address[](1);
        p = new uint256[](1);
        (t[0], p[0]) = (tok[6], px[6] - 1); // SPY (Common pack) ticks down
        ps.setPrices(t, p);
        b2.setPrizes(m.id, table);

        vm.revertToState(snap);
        (t[0], p[0]) = (tok[0], px[0] + 1); // NVDA (Jackpot pack) ticks up
        ps.setPrices(t, p);
        b2.setPrizes(m.id, table);

        vm.revertToState(snap);
        (t[0], p[0]) = (tok[6], px[6] * 95 / 100); // a real 5% SPY drop (2% of the pack) still reverts: floor holds
        ps.setPrices(t, p);
        vm.expectRevert();
        b2.setPrizes(m.id, table);
    }

    // ------------------------------------------------------------------ INFO: reroll only if D20 broke its deadline rule

    /// Arclaw's "expired" == D20's "can never be fulfilled" only if D20 rejects proofs after `deadline`
    /// (API.md: accepted at timestamp <= deadline). If a late word were ever accepted, the opener who sees it in
    /// the mempool (D20: "the pending fulfillment reveals the word about one block before it lands") can
    /// front-run with returnBoxes and reopen: a free re-roll. Shown with the mock's deadline-free fulfillStarved.
    function test_fixed_INFO_lateFulfilAfterReturn_isIgnored() public {
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
