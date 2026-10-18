// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";

/// Auditor 4b. Each test passes by demonstrating the finding as the code stands at f0345b5.
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

    /// M-01: after a VRF expiry the opener holds a free option on the pinned table. retry() re-requests on the old
    /// table with no price-move or table-age check (and works while paused), so when the card prices rose the opener
    /// retries and is paid shares worth 40% more than the table; open() refuses the same table (TableStale).
    function test_m01_retryRevivesAStaleTable() public {
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

        box.pause(); // even a pause does not close the option
        vm.prank(alice);
        uint256 req2 = box.retry(id); // subsidised, no price check, no age check, not pause-gated
        assertTrue(req2 != req);
        vrf.fulfill(req2, keccak256("any"));
        uint256 before = nvda.balanceOf(alice);
        vm.prank(alice);
        box.reveal(id);
        uint256 got = nvda.balanceOf(alice) - before;
        // cards are share amounts fixed at 200 USD; at 280 USD they are worth 1.4x the table value
        uint256 liveValue = box.valueOf(address(nvda), got);
        uint256 tableValue = got * 200e6 * 1e12 / 1e18;
        assertEq(liveValue * 10_000 / tableValue, 14_000, "paid 40% above the advertised table");
    }

    /// M-01 (other leg): when prices fell instead, the opener calls returnBoxes and re-opens on a fresh table, so the
    /// loss the stale table would have paid is never taken. With retry on the way up the opener captures any move.
    function test_m01_returnBoxesDodgesAFall() public {
        _play(alice, M1, 20);
        (uint256 id,) = _open(alice, M1, 20);
        vm.warp(block.timestamp + 61);
        _setNvda(160e6); // -20%: the pinned table now returns 0.60x instead of 0.75x
        assertEq(_liveRtpBps(), 6000);
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.balanceOf(alice, M1), 20, "boxes back, sealed");
        box.setPrizes(M1, _table(address(nvda), P1)); // repriced at 160 USD: back to 0.75x
        _open(alice, M1, 20);
        assertEq(_liveRtpBps(), 7500);
    }

    // ------------------------------------------------------------------ L-01

    /// L-01: the floor is only enforced at table time. open() accepts a table whose cards fell up to maxPriceMoveBps
    /// (default 5%), so the 0.5x pack is paid at 47.6% of the price, under the at-least-half-back promise.
    function test_l01_floorBrokenInsidePriceTolerance() public {
        _setNvda(190.5e6); // -4.75%, inside the 5% band
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, _wordFor(0)); // the common 0.5x pack
        vm.prank(alice);
        box.reveal(id);
        uint256 v = box.valueOf(address(nvda), nvda.balanceOf(alice));
        assertEq(v * 10_000 / P1, 4762, "below the 50% floor");
    }

    /// L-01 (upper side): with the maximum guard the owner may set (20%) and a 94% table (MAX_RTP_BPS allows 95%),
    /// open() accepts a +19.5% move: the box pays 112% of its price, a negative house edge, although MAX_RTP_BPS
    /// promises at least 5%.
    function test_l01_rtpAboveHundredInsideOwnerTolerance() public {
        _forceSingle(M1, address(nvda), 0.94 ether);
        box.setGuards(2000, 0);
        _setNvda(239e6); // +19.5%
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("x"));
        vm.prank(alice);
        box.reveal(id);
        uint256 v = box.valueOf(address(nvda), nvda.balanceOf(alice));
        assertGt(v, P1, "paid more than the price");
    }

    // ------------------------------------------------------------------ L-02

    /// L-02: a sealed box has no exit when its machine is switched off or the operator stops repricing (tables
    /// expire after at most one day). The price stays in sealedReserve: the player cannot open or refund, the owner
    /// cannot withdraw it.
    function test_l02_sealedBoxesHaveNoExit() public {
        _play(alice, M1, 5);
        uint256 shown = box.currentTable(M1) - 1;
        box.setMachineActive(M1, false);
        vm.prank(alice);
        vm.expectRevert(Arclaw.MachineOff.selector);
        box.open(M1, 5, shown);

        box.setMachineActive(M1, true);
        vm.warp(block.timestamp + 1 days + 1); // operator offline: table aged out
        vm.prank(alice);
        vm.expectRevert(Arclaw.TableStale.selector);
        box.open(M1, 5, shown);

        assertEq(box.sealedReserve(), 5 ether);
        assertEq(box.freeBalance(), 0);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.withdraw(alice, 5 ether);
    }

    // ------------------------------------------------------------------ L-03

    /// L-03: when the VRF fee is above maxVrfSubsidy the opener tops it up; if the request then expires, D20 refunds
    /// the full fee to Arclaw and returnBoxes keeps it all, so the player pays for a VRF failure.
    function test_l03_expiredTopUpIsKeptByTheHouse() public {
        vm.deal(address(box), 1 ether); // a house float, so the subsidy is not drawn from reserves
        vrf.setFee(0.3 ether); // subsidy 0.1: alice pays 0.2
        _play(alice, M1, 1);
        uint256 tableId = box.currentTable(M1) - 1;
        uint256 a0 = alice.balance;
        vm.prank(alice);
        (uint256 id,) = box.open{value: 0.2 ether}(M1, 1, tableId);
        assertEq(a0 - alice.balance, 0.2 ether);
        vm.warp(block.timestamp + 61);
        uint256 free0 = box.freeBalance();
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.freeBalance() - free0, 0.3 ether, "house keeps the whole refunded fee");
        assertEq(a0 - alice.balance, 0.2 ether, "the top-up is gone, only the box came back");
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
