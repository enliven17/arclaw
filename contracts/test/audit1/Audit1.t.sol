// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
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

/// Audit #1 PoCs. Tests named test_FINDING_* assert the vulnerable behaviour today (they pass on the current code
/// and must be flipped once the fix lands). Tests named test_SAFE_* are regression guards for properties that hold.
contract Audit1Test is Base {
    // ------------------------------------------------------------------ H-01

    /// H-01a: lowering a machine's price keeps serving the table priced for the old price.
    function test_FINDING_H01_priceCutServesOldTable() public {
        box.setPrizes(M2, _table(address(tsla), P2)); // $5 table: packs worth $2.50 or $7.50
        // Owner reprices machine 2 to $1 (e.g. a promo), intending to call setPrizes next.
        box.setMachine(M2, uint128(P1), 5000, 100_000, 6000, 8500);

        (uint256 rtpBps,,,) = box.tableStats(box.currentTable(M2) - 1);
        assertEq(rtpBps, 37_500, "live table now pays 375% of the box price");
        assertGt(rtpBps, box.MAX_RTP_BPS());

        // Attacker back-runs setMachine: 20 boxes at $1 each.
        _play(alice, M2, 20);
        (uint256 id, uint256 req) = _open(alice, M2, 20);
        vrf.fulfill(req, keccak256("any word"));
        box.reveal(id);
        uint256 got = box.valueOf(address(tsla), tsla.balanceOf(alice));
        // Floor of the old table alone is $2.50 per box.
        assertGe(got, 20 * 2.5 ether - 1e6);
        assertGt(got, 2 * 20 * P1, "attacker more than doubled 20 USDC");
    }

    /// H-01b: boxes bought before a price rise open against the new, richer table (boxes are fungible per id and
    /// the table is frozen at open, not at purchase).
    function test_FINDING_H01_boxesBoughtCheapOpenOnRepricedTable() public {
        box.setPrizes(M1, _table(address(nvda), P1)); // $1 table
        _play(alice, M1, 20); // pays 20 USDC

        // Owner turns machine 1 into a $10 machine and installs a $10 table.
        uint256 p10 = 10 ether;
        box.setMachine(M1, uint128(p10), 5000, 100_000, 6000, 8500);
        box.setPrizes(M1, _table(address(nvda), p10));

        (uint256 id, uint256 req) = _open(alice, M1, 20);
        vrf.fulfill(req, keccak256("w"));
        box.reveal(id);
        uint256 got = box.valueOf(address(nvda), nvda.balanceOf(alice));
        assertGe(got, 20 * 5 ether - 1e6, "every box now worth >= $5 (floor of $10 table)");
        assertGt(got, 4 * 20 * P1);
    }

    // ------------------------------------------------------------------ L: retry subsidy drain

    /// Any third party can call retry() on every expired opening with msg.value = 0; each call spends up to
    /// maxVrfSubsidy from the treasury. The old fee only comes back if someone calls coordinator.refundRequest.
    function test_FINDING_retryBurnsSubsidyForAnyone() public {
        box.setPrizes(M1, _table(address(nvda), P1));
        vm.deal(address(box), 10 ether);
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        uint256 start = address(box).balance;
        address griefer = makeAddr("griefer");
        uint256 now_ = block.timestamp;
        for (uint256 i; i < 5; ++i) {
            now_ += 61;
            vm.warp(now_); // D20 outage: nothing fulfils
            vm.prank(griefer);
            box.retry(id);
        }
        assertEq(start - address(box).balance, 5 * vrf.fee(), "treasury paid 5 extra fees");
    }

    // ------------------------------------------------------------------ I: unreserved liabilities

    /// Credit owed to players is not reserved: owner withdraw (or VRF fees / refunds) can spend it.
    function test_FINDING_creditNotReserved() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.sweep(address(nvda), address(1), 100 ether); // inventory empty: card refunds
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        // Pool has only the 1 USDC play minus the VRF fee, so the 0.75 refund is pushed. Drain first instead:
        box.withdraw(address(0xBEEF), address(box).balance);
        box.reveal(id); // push fails (no balance): becomes credit
        assertEq(box.credit(alice), 0.75 ether);
        vm.prank(alice);
        vm.expectRevert(Arclaw.TransferFailed.selector);
        box.claimCredit();
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

    /// Large tables: setPrizes for N outcomes costs far more than the draw loop in reveal, so the 30M block limit
    /// bounds N long before reveal(20) becomes unexecutable.
    function test_SAFE_largeTableRevealStillFits() public {
        uint256 n = 100;
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
        emit log_named_uint("setPrizes(100) gas", setGas);
        emit log_named_uint("reveal(20) on 100-outcome table, worst-case scan", revealGas);
        assertGt(setGas, revealGas);
    }

    // ------------------------------------------------------------------ SAFE: claim link domain binding

    function test_SAFE_linkSignatureBoundToContract() public {
        Arclaw other = new Arclaw("x", address(vrf), SUBSIDY);
        (address key, uint256 pk) = makeAddrAndKey("linkkey");
        _play(alice, M1, 1);
        vm.prank(alice);
        uint256 linkId = box.createLink(key, M1, 1, uint40(block.timestamp + 1 days));
        // signature made for the other deployment (same linkId) must not work here
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(pk, other.claimDigest(linkId, bob));
        vm.expectRevert(Arclaw.BadSignature.selector);
        box.claimLink(linkId, bob, abi.encodePacked(r, s_, v));
        // and a signature for bob cannot be redirected to the relayer
        (v, r, s_) = vm.sign(pk, box.claimDigest(linkId, bob));
        vm.expectRevert(Arclaw.BadSignature.selector);
        box.claimLink(linkId, address(this), abi.encodePacked(r, s_, v));
        box.claimLink(linkId, bob, abi.encodePacked(r, s_, v));
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
