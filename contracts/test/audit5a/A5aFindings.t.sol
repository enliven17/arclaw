// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {MockStock} from "../../src/mocks/MockStock.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ArclawLens} from "../../src/ArclawLens.sol";
import {ArcConfig} from "../../script/Deploy.s.sol";
import {Builder} from "../MachinesJson.t.sol";
import {MockPriceSource} from "../../src/mocks/MockPriceSource.sol";
import {MockVRFCoordinator} from "../../src/mocks/MockVRFCoordinator.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";

/// Opener whose receive() burns every unit of gas it is given (only when it is pushed a refund).
contract GasBurner {
    Arclaw public immutable box;

    constructor(Arclaw b) payable {
        box = b;
    }

    function play(uint256 machineId, uint256 n, uint256 value) external {
        box.play{value: value}(machineId, n);
    }

    function open(uint256 machineId, uint256 n, uint256 tableId) external returns (uint256 id, uint256 req) {
        return box.open(machineId, n, tableId);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    receive() external payable {
        while (true) {}
    }
}

contract A5aFindings is Base {
    address sink = makeAddr("sink");

    receive() external payable {}

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setPrizes(M2, _table(address(nvda), P2));
    }

    /// A word whose box 0 draws outcome 1 (the 1.5x pack) of the 3:1 test table.
    function _bigWord() internal pure returns (bytes32 w) {
        for (uint256 i;; ++i) {
            w = bytes32(i);
            if (uint256(keccak256(abi.encode(w, uint256(0)))) % 4 == 3) return w;
        }
    }

    function _req(uint256 openingId) internal view returns (uint256 r) {
        (,,,,,, r,) = box.openings(openingId);
    }

    // ------------------------------------------------------------------ M-01

    /// M-01: refundSealed's clock only runs while the machine is off or its table is stale. A paused contract (owner
    /// pause, or the automatic pause after any IOU, which only the owner lifts) with the operator bot still repricing
    /// daily leaves sealed boxes neither openable nor refundable, for as long as the pause lasts.
    function test_m01_pauseWithFreshTablesTrapsSealedBoxes() public {
        _play(alice, M1, 2);
        box.pause();
        Arclaw.OutcomeInput[] memory fresh = _table(address(nvda), P1);
        for (uint256 d; d < 30; ++d) {
            vm.warp(block.timestamp + 1 days);
            vm.prank(op);
            box.operatorSetPrizes(M1, fresh);
        }
        uint256 tableId = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        box.open(M1, 1, tableId);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M1, 2); // 30 days later, still no exit
        assertEq(box.balanceOf(alice, M1), 2);

        // control: once the reprices stop, the stale clock runs and the exit opens 1 + 3 days later
        vm.warp(block.timestamp + 4 days + 1);
        uint256 before = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 2);
        assertEq(alice.balance - before, 2 * P1);
    }

    // ------------------------------------------------------------------ L-01

    /// L-01: an expired request's VRF top-up is paid back only from the unreserved balance. With an IOU outstanding
    /// (_unreserved subtracts totalOwed) the D20 refund of exactly that fee is absorbed and the opener gets nothing:
    /// no transfer, no credit, no owed. The opener's own money pays other players' IOUs.
    function test_l01_topUpLostWhileIousOutstanding() public {
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(box).call{value: 1 ether}(""); // house treasury covers the subsidies
        assertTrue(ok);
        vrf.setFee(0.15 ether); // subsidy 0.1 => top-up 0.05

        _play(alice, M1, 1);
        _play(bob, M2, 1);
        uint256 t1 = box.currentTable(M1) - 1;
        uint256 t2 = box.currentTable(M2) - 1;
        vm.prank(alice);
        (uint256 aId,) = box.open{value: 0.05 ether}(M1, 1, t1);
        assertEq(box.openingTopUp(aId), 0.05 ether);
        vm.prank(bob);
        (uint256 bId,) = box.open{value: 0.05 ether}(M2, 1, t2);

        // bob's big pack, stock not on hand, free balance out: bob gets an IOU and the contract pauses
        vrf.fulfill(_req(bId), _bigWord());
        box.sweep(address(nvda), sink, nvda.balanceOf(address(box)));
        box.withdraw(sink, box.freeBalance());
        vm.prank(bob);
        box.reveal(bId);
        assertGt(box.totalOwed(), 0);
        assertTrue(box.paused());

        // alice's request never landed; once the table ages out she takes her box back
        vm.warp(block.timestamp + 1 days + 61);
        uint256 before = alice.balance;
        vm.prank(alice);
        box.returnBoxes(aId);
        assertEq(box.balanceOf(alice, M1), 1);
        assertEq(alice.balance, before, "top-up not paid");
        assertEq(box.credit(alice), 0, "not credited");
        assertEq(box.owed(alice), 0, "not owed either");
        assertEq(box.openingTopUp(aId), 0, "and the record is gone");
    }

    // ------------------------------------------------------------------ INFO

    /// INFO-1: an expired opening whose prices left the band (or whose floor broke at live prices) can neither retry
    /// nor return until its table ages out: up to maxTableAge (<= 1 day) of the player's box price locked. Bounded.
    function test_info_expiredOpeningWaitsForTableAge() public {
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        vm.warp(block.timestamp + 61);
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        (t[0], p[0]) = (address(nvda), 212e6); // +6%
        prices.setPrices(t, p);

        vm.expectRevert(Arclaw.TableStale.selector);
        box.retry(id);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.returnBoxes(id);

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.balanceOf(alice, M1), 1);
    }

    /// INFO-2: _call forwards all gas. An opener whose receive() burns gas makes every keeper reveal that pushes it a
    /// refund cost the keeper (63/64 of) its whole gas limit; the reveal still settles (credit) with enough gas.
    function test_info_gasBurnerOpenerTaxesKeeper() public {
        GasBurner g = new GasBurner{value: 10 ether}(box);
        g.play(M1, 1, P1);
        uint256 tableId = box.currentTable(M1) - 1;
        (uint256 id, uint256 req) = g.open(M1, 1, tableId);
        vrf.fulfill(req, bytes32(0));
        box.sweep(address(nvda), sink, nvda.balanceOf(address(box))); // every card refunds => a push
        uint256 g0 = gasleft();
        box.reveal{gas: 5_000_000}(id);
        uint256 used = g0 - gasleft();
        assertGt(box.credit(address(g)), 0, "settled as credit");
        assertGt(used, 4_800_000, "keeper paid the burner's gas");
    }

    /// INFO-3: lib/machines.json lands on chain (rtp 60..88%), but the Vault table realises 85.7% (85.8% at max
    /// boost), above the 75..85% band CLAUDE.md promises; rtpMinBps 6000 is also under the promised 75%.
    function test_info_machinesJsonVsProductBand() public {
        Builder b = new Builder();
        Arclaw x = new Arclaw("", address(new MockVRFCoordinator()), 0.1 ether);
        MockPriceSource ps = new MockPriceSource();
        address[8] memory tok;
        uint256[8] memory px = [uint256(180e6), 250e6, 230e6, 220e6, 700e6, 190e6, 650e6, 560e6];
        address[] memory t = new address[](8);
        uint256[] memory p = new uint256[](8);
        for (uint256 i; i < 8; ++i) {
            tok[i] = address(new MockStock("X.arc"));
            (t[i], p[i]) = (tok[i], px[i]);
        }
        ps.setPrices(t, p);
        x.setPolicy(IPriceSource(address(ps)), 0);
        ArcConfig.Policy memory pol = b.policy();
        ArcConfig.MachineCfg[] memory ms = b.machinesCfg();
        assertLt(pol.rtpMinBps, 7500, "rtpMin under the product band");
        ArcConfig.MachineCfg memory vault = ms[2];
        x.setMachine(
            vault.id, uint128(vault.priceUsdc * 1e18), uint16(pol.floorBps), uint32(vault.capBps),
            uint16(pol.rtpMinBps), uint16(pol.rtpMaxBps)
        );
        x.setPrizes(vault.id, b.buildFor(vault, tok, px));
        (uint256 rtp,,,) = new ArclawLens().stats(x, vault.id);
        assertGt(rtp, 8500, "Vault RTP above the 85% product cap");
    }

    /// INFO-4: Arclaw's runtime is within ~300 bytes of EIP-170; the next fix will need more code moved out.
    function test_info_codeSizeMargin() public view {
        uint256 size = address(box).code.length;
        assertLt(size, 24_576);
        assertLt(24_576 - size, 400);
    }
}
