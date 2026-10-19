// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {MockStock} from "../../src/mocks/MockStock.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// An opener contract whose receive() can answer a refund push with the largest revert it can afford. The caller of
/// a low-level `(bool ok,) = to.call{value: x}("")` still copies the returndata into memory, and after EIP-150 it has
/// only 1/64 of the gas the callee had: it can never pay that memory expansion, whatever gas the keeper sends.
contract BombOpener {
    Arclaw public immutable box;
    bool public armed;

    constructor(Arclaw b) payable {
        box = b;
    }

    function arm(bool a) external {
        armed = a;
    }

    function play(uint256 machineId, uint256 n, uint256 value) external {
        box.play{value: value}(machineId, n);
    }

    function open(uint256 machineId, uint256 n, uint256 tableId) external returns (uint256 id, uint256 req) {
        return box.open(machineId, n, tableId);
    }

    function reveal(uint256 id) external {
        box.reveal(id);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    receive() external payable {
        if (!armed) return;
        // memory cost of w words: 3w + w^2/512; spend ~80% of what is left on it
        uint256 w = Math.sqrt(gasleft() * 512 * 8 / 10);
        assembly {
            revert(0, mul(w, 32))
        }
    }
}

contract A4aFindings is Base {
    MockStock amd; // $100, never stocked: every card is a refund (JIT off)
    uint256 constant KEEPER_GAS = 30_000_000; // a full Arc block

    receive() external payable {}

    function setUp() public override {
        super.setUp();
        amd = new MockStock("AMD.arc");
        _setPrice(address(amd), 100e6);
    }

    function _setPrice(address token, uint256 p) internal {
        address[] memory t = new address[](1);
        uint256[] memory px = new uint256[](1);
        (t[0], px[0]) = (token, p);
        prices.setPrices(t, px);
    }

    function _revealAs(address who, uint256 id) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(box).call{gas: KEEPER_GAS}(abi.encodeCall(Arclaw.reveal, (id)));
    }

    function _rescueAs(address who, uint256 id) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(box).call{gas: KEEPER_GAS}(abi.encodeCall(Arclaw.rescue, (id)));
    }

    function _bombOpening() internal returns (BombOpener bomb, uint256 id) {
        _forceSingle(M1, address(amd), 0.75 ether);
        bomb = new BombOpener{value: 10 ether}(box);
        bomb.play(M1, 1, P1);
        uint256 req;
        (id, req) = bomb.open(M1, 1, box.currentTable(M1) - 1);
        vrf.fulfill(req, keccak256("w"));
    }

    // ------------------------------------------------------------------ L-01 (4a)

    /// L-01 fixed: _sendNative calls with no returndata copy, so a return bomb costs the caller nothing. The armed
    /// opener's refund push fails and becomes pull credit; the keeper's reveal settles at once at the refund value,
    /// and the opener can no longer wait for a price rise and a restock to take the stock instead.
    function test_fixed_l01_returnBombCannotBlockKeeperReveal() public {
        (BombOpener bomb, uint256 id) = _bombOpening();
        bomb.arm(true);
        assertTrue(_revealAs(address(this), id), "keeper reveal settles");
        _assertSettledAsCredit(bomb, id);
    }

    /// L-01 fixed: same for the public reveal an hour after the request.
    function test_fixed_l01_returnBombCannotBlockPublicReveal() public {
        (BombOpener bomb, uint256 id) = _bombOpening();
        bomb.arm(true);
        vm.warp(block.timestamp + 1 hours);
        assertTrue(_revealAs(bob, id), "public reveal settles");
        _assertSettledAsCredit(bomb, id);
    }

    /// L-01 fixed: and for rescue after 7 days (cash at the refund value).
    function test_fixed_l01_returnBombCannotBlockRescue() public {
        (BombOpener bomb, uint256 id) = _bombOpening();
        bomb.arm(true);
        vm.warp(block.timestamp + 7 days);
        assertTrue(_rescueAs(address(this), id), "rescue settles");
        _assertSettledAsCredit(bomb, id);
    }

    function _assertSettledAsCredit(BombOpener bomb, uint256 id) internal {
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Revealed));
        assertApproxEqAbs(box.credit(address(bomb)), 0.75 ether, 10, "refund kept as pull credit");
        assertEq(box.reservedCredit(), box.credit(address(bomb)));
        // a later price rise and restock change nothing: the opening is closed
        _setPrice(address(amd), 150e6);
        amd.mint(address(box), 100 ether);
        bomb.arm(false);
        vm.expectRevert(Arclaw.NotPending.selector);
        bomb.reveal(id);
        assertEq(amd.balanceOf(address(bomb)), 0);
    }

    /// Control: unarmed, the keeper settles at once with the refund (table value, capped).
    function test_l01_control_unarmedKeeperRevealRefunds() public {
        (BombOpener bomb, uint256 id) = _bombOpening();
        uint256 before = address(bomb).balance;
        assertTrue(_revealAs(address(this), id));
        assertApproxEqAbs(address(bomb).balance - before, 0.75 ether, 10);
    }

    // ------------------------------------------------------------------ INFO (4a)

    /// INFO: an oracle outage (Astock isStale on weekends/holidays, or an unmapped token) makes open() revert in
    /// _checkPrices, not TableStale: no box of the machine opens until the feed returns and the table is repriced.
    /// Reveals keep working on lastPrice.
    function test_info_oracleOutageHaltsOpensNotReveals() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        _play(alice, M1, 2);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        _setPrice(address(nvda), 0); // MockPriceSource: priceOf reverts Unpriced, like AstockPriceSource on Stale
        uint256 t = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert();
        box.open(M1, 1, t);
        box.reveal(id); // still settles
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Revealed));
    }

    /// INFO-2 fixed: a machine switched off for SEALED_REFUND_AFTER (3 days) lets holders burn sealed boxes for
    /// the price paid. Before that, and for the owner, the reserve stays locked. Switching off again does not reset
    /// the clock. (Global pause is not a trigger; the table it lets age out is, see audit 4b L-02.)
    function test_fixed_info2_sealedBoxesRefundAfterThreeDaysOff() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        _play(alice, M1, 1);
        box.setMachineActive(M1, false);
        uint256 off = block.timestamp;
        uint256 t = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(Arclaw.MachineOff.selector);
        box.open(M1, 1, t);
        assertEq(box.sealedReserve(), P1);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.withdraw(address(this), P1);

        // keep the table fresh so only the off switch counts
        vm.warp(off + 2 days);
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.setMachineActive(M1, false); // off again: the clock keeps its start
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M1, 1);

        vm.warp(off + 3 days);
        uint256 a0 = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 1);
        assertEq(alice.balance - a0, P1, "price paid back");
        assertEq(box.balanceOf(alice, M1), 0, "box burnt");
        assertEq(box.sealedReserve(), 0);
    }

    /// INFO (trust): the box price is reserved, the prize is not. The word is public at fulfil, so the owner can see a
    /// big pack coming, sweep its stock and withdraw the free balance first: the winner's reveal turns into an IOU
    /// (paused), payable only as future revenue frees up.
    function test_info_ownerCanTurnAVisibleWinIntoAnIou() public {
        Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](2);
        t[0] = _pack(address(nvda), 98, 0, P1 * 6 / 10);
        t[1] = _pack(address(nvda), 2, 1, P1 * 9); // 9x pack
        box.setPrizes(M1, t);
        vm.deal(address(box), address(box).balance + 50 ether); // house float
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        bytes32 word;
        for (uint256 i;; ++i) {
            word = keccak256(abi.encode(i));
            if (uint256(keccak256(abi.encode(word, uint256(0)))) % 100 >= 98) break; // draws the 9x pack
        }
        vrf.fulfill(req, word); // the word, hence the 9x pack, is now public

        box.sweep(address(nvda), address(this), nvda.balanceOf(address(box)));
        box.setJit(address(0), 0, 0, 0, 0); // the owner drops the reserve floor too
        box.withdraw(address(this), box.freeBalance());
        box.reveal(id);
        assertApproxEqAbs(box.owed(alice), 8 ether, 10, "9x win: 1x paid from its own price, 8x an IOU");
        assertTrue(box.paused());
    }

    /// INFO-4 fixed: total weight is bounded against the price (W^2 <= 2^234 / price), so huge weights revert
    /// with the named WeightTooHigh(total) instead of a 0x11 panic.
    function test_fixed_info4_hugeWeightsNamedError() public {
        Arclaw.OutcomeInput[] memory t = new Arclaw.OutcomeInput[](64);
        for (uint256 i; i < 64; ++i) {
            t[i] = _pack(address(nvda), type(uint88).max, 0, P1 * (i % 2 == 0 ? 6 : 8) / 10);
        }
        vm.expectRevert(abi.encodeWithSelector(Arclaw.WeightTooHigh.selector, uint256(type(uint88).max) * 64));
        box.setPrizes(M1, t);
    }
}
