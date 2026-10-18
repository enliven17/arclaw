// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {ArclawLinks} from "../../src/ArclawLinks.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {MockStock} from "../../src/mocks/MockStock.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Prize token whose transfer burns a lot of gas (models an expensive proxied / compliance-checked .arc token).
contract GasHogStock is ERC20 {
    constructor() ERC20("HOG.arc", "HOG.arc") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        // burns ~400k and runs out of gas (never a cheap revert) if it does not have it
        uint256 start = gasleft();
        while (start - gasleft() < 400_000) {}
    }
}

/// Audit #1 PoCs, flipped after the fix pass: test_fixed_* assert the FIXED behaviour of each finding.
/// Tests named test_SAFE_* are regression guards for properties that held from the start.
contract Audit1Test is Base {
    // ------------------------------------------------------------------ H-01

    /// H-01a fixed: a machine's price can never change, so a live table can never be re-rated by a price cut.
    function test_fixed_H01_priceCutImpossible() public {
        box.setPrizes(M2, _table(address(tsla), P2));
        vm.expectRevert(Arclaw.PriceImmutable.selector);
        box.setMachine(M2, uint128(P1), 5000, 100_000, 6000, 8500);
        (uint256 rtpBps,,,) = lens.stats(box, M2);
        assertEq(rtpBps, 7500, "table still priced against 5 USDC");
        // A cheaper promo is a new machine id with its own table and its own boxes.
        box.setMachine(5, uint128(P1), 5000, 100_000, 6000, 8500);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NoPrizes.selector);
        box.open(5, 1, 0);
    }

    /// H-01b fixed: boxes bought at 1 USDC can only ever open against a 1 USDC table.
    function test_fixed_H01_repriceIsNewMachine() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 20);
        uint256 p10 = 10 ether;
        vm.expectRevert(Arclaw.PriceImmutable.selector);
        box.setMachine(M1, uint128(p10), 5000, 100_000, 6000, 8500);
        box.setMachine(7, uint128(p10), 5000, 100_000, 6000, 8500);
        box.setPrizes(7, _table(address(nvda), p10));

        (uint256 id, uint256 req) = _open(alice, M1, 20);
        vrf.fulfill(req, keccak256("w"));
        box.reveal(id);
        uint256 got = box.valueOf(address(nvda), nvda.balanceOf(alice));
        assertLe(got, 20 * 1.5 ether, "every box drew from the 1 USDC table (max pack 1.5)");
    }

    // ------------------------------------------------------------------ L: retry subsidy drain

    /// Fixed: a stranger's retry pays the full fee, and the expired fee is reclaimed first, so the treasury never
    /// pays for someone else's retries. The opener keeps a free retry.
    function test_fixed_retryCostsStranger() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        vm.deal(address(box), 10 ether);
        _play(alice, M1, 1);
        uint256 t0 = block.timestamp;
        (uint256 id,) = _open(alice, M1, 1);
        uint256 start = address(box).balance;
        address griefer = makeAddr("griefer");
        vm.deal(griefer, 1 ether);
        uint256 fee = vrf.fee();
        for (uint256 i = 1; i <= 5; ++i) {
            vm.warp(t0 + 61 * i); // D20 outage: nothing fulfils
            vm.prank(griefer);
            vm.expectRevert(abi.encodeWithSelector(Arclaw.VrfFeeTopUp.selector, fee, 0));
            box.retry(id);
            vm.prank(griefer);
            box.retry{value: fee}(id);
        }
        assertEq(address(box).balance, start + 5 * fee, "treasury got every expired fee back; griefer paid");
        vm.warp(t0 + 61 * 6);
        vm.prank(alice);
        box.retry(id); // the opener's retry is free and balance-neutral
        assertEq(address(box).balance, start + 5 * fee);
    }

    // ------------------------------------------------------------------ I: unreserved liabilities

    /// Fixed: the price paid for a pending box (and any owed credit) is reserved; the owner cannot withdraw it, so
    /// the refund is paid in full at reveal.
    function test_fixed_creditReserved() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.sweep(address(nvda), address(1), 100 ether); // inventory empty: card refunds
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        uint256 bal = address(box).balance;
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.withdraw(address(0xBEEF), bal);
        uint256 before = alice.balance;
        box.reveal(id);
        assertEq(alice.balance - before, 0.75 ether, "refund paid, not an IOU");
        assertEq(box.credit(alice), 0);
    }

    // ------------------------------------------------------------------ SAFE: gas griefing of card transfers

    /// The caller of reveal controls the gas. Starving a card transfer would turn a paid card into a refund at the
    /// (stale) table value. EIP-150 makes this infeasible: the 1/64 left after a starved call cannot finish reveal.
    function test_SAFE_revealGasStarvationCannotForceRefund() public {
        GasHogStock hog = new GasHogStock();
        hog.mint(address(box), 100 ether);
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        (t[0], p[0]) = (address(hog), 200e6);
        prices.setPrices(t, p);
        _forceSingle(M1, address(hog), 0.75 ether);

        _play(alice, M1, 2);
        (uint256 id, uint256 req) = _open(alice, M1, 2);
        vrf.fulfill(req, keccak256("w"));

        uint256 successes;
        for (uint256 g = 100_000; g < 3_500_000; g += 7_000) {
            uint256 snap = vm.snapshotState();
            (bool ok,) = address(box).call{gas: g}(abi.encodeCall(Arclaw.reveal, (id)));
            if (ok) {
                ++successes;
                assertEq(box.cardsRefunded(), 0, "starved gas forced a refund");
                assertEq(box.cardsPaid(), 6);
            }
            vm.revertToState(snap);
        }
        assertGt(successes, 0);
    }

    // ------------------------------------------------------------------ SAFE: reveal(20) fits a block

    function test_SAFE_reveal20RealisticGas() public {
        MockStock[8] memory s;
        address[] memory t = new address[](8);
        uint256[] memory p = new uint256[](8);
        for (uint256 i; i < 8; ++i) {
            s[i] = new MockStock("X.arc");
            s[i].mint(address(box), 1_000_000 ether);
            (t[i], p[i]) = (address(s[i]), (100 + 50 * i) * 1e6);
        }
        prices.setPrices(t, p);
        box.setMachine(M1, uint128(P1), 5000, 100_000, 6000, 8500);
        uint24[6] memory mult = [uint24(5000), 8000, 12_000, 20_000, 40_000, 100_000];
        uint88[6] memory w = [uint88(5055), 3000, 1600, 250, 80, 15];
        Arclaw.OutcomeInput[] memory tab = new Arclaw.OutcomeInput[](6);
        for (uint256 k; k < 6; ++k) {
            uint256 v = P1 * mult[k] / 10_000;
            tab[k].weight = w[k];
            tab[k].tier = uint8(k);
            for (uint256 c; c < 3; ++c) {
                address tok = t[(k + c * 3) % 8];
                uint256 px = p[(k + c * 3) % 8];
                uint256 vc = c == 2 ? v - 2 * (v * 40 / 100) : v * 40 / 100;
                tab[k].tokens[c] = tok;
                tab[k].amounts[c] = k == 5 ? vc * 1e6 / px : (vc * 1e6 + px - 1) / px; // as Deploy does
            }
        }
        box.setPrizes(M1, tab);

        _play(alice, M1, 20);
        uint256 g0 = gasleft();
        (uint256 id, uint256 req) = _open(alice, M1, 20);
        uint256 openGas = g0 - gasleft();
        vrf.fulfill(req, keccak256("w"));
        g0 = gasleft();
        box.reveal(id);
        uint256 revealGas = g0 - gasleft();
        emit log_named_uint("open(20) gas", openGas);
        emit log_named_uint("reveal(20) gas", revealGas);
        assertLt(revealGas, 5_000_000);
    }

    /// Large tables (now capped at MAX_OUTCOMES = 64): setPrizes for N outcomes costs far more than the draw loop in
    /// reveal, so reveal(20) stays executable.
    function test_SAFE_largeTableRevealStillFits() public {
        uint256 n = 64;
        box.setMachine(M1, uint128(P1), 5000, 100_000, 7500, 7500);
        Arclaw.OutcomeInput[] memory tab = new Arclaw.OutcomeInput[](n);
        for (uint256 i; i < n; ++i) {
            tab[i] = _pack(address(nvda), i == n - 1 ? type(uint88).max / 2 : 1, 0, 0.75 ether);
        }
        uint256 g0 = gasleft();
        box.setPrizes(M1, tab);
        uint256 setGas = g0 - gasleft();
        _play(alice, M1, 20);
        (uint256 id, uint256 req) = _open(alice, M1, 20);
        vrf.fulfill(req, keccak256("w"));
        g0 = gasleft();
        box.reveal(id);
        uint256 revealGas = g0 - gasleft();
        emit log_named_uint("setPrizes(64) gas", setGas);
        emit log_named_uint("reveal(20) on 64-outcome table, worst-case scan", revealGas);
        assertGt(setGas, revealGas);
    }

    // ------------------------------------------------------------------ SAFE: claim link domain binding

    function test_SAFE_linkSignatureBoundToContract() public {
        ArclawLinks other = new ArclawLinks(IERC1155(address(box)));
        (address key, uint256 pk) = makeAddrAndKey("linkkey");
        _play(alice, M1, 1);
        uint256 linkId = _link(alice, key, M1, 1, block.timestamp + 1 days);
        // signature made for the other deployment (same linkId) must not work here
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(pk, other.claimDigest(linkId, bob));
        vm.expectRevert(ArclawLinks.BadSignature.selector);
        links.claimLink(linkId, bob, abi.encodePacked(r, s_, v));
        // and a signature for bob cannot be redirected to the relayer
        (v, r, s_) = vm.sign(pk, links.claimDigest(linkId, bob));
        vm.expectRevert(ArclawLinks.BadSignature.selector);
        links.claimLink(linkId, address(this), abi.encodePacked(r, s_, v));
        links.claimLink(linkId, bob, abi.encodePacked(r, s_, v));
        assertEq(box.balanceOf(bob, M1), 1);
    }

    // ------------------------------------------------------------------ SAFE: no re-roll once the word exists

    function test_SAFE_noReturnOrRetryAfterFulfilledEvenIfCallbackFailed() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfillStarved(req, keccak256("bad word")); // word public, callback failed, status still Pending
        vm.warp(block.timestamp + 3600);
        vm.prank(alice);
        vm.expectRevert(Arclaw.AlreadyFulfilled.selector);
        box.returnBoxes(id);
        vm.expectRevert(Arclaw.AlreadyFulfilled.selector);
        box.retry(id);
        box.reveal(id);
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Revealed));
    }
}
