// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {MockStock} from "../../src/mocks/MockStock.sol";

/// Desk that tries to re-enter Arclaw during buy(), then either delivers or short-delivers.
contract EvilDesk {
    Arclaw immutable box;
    uint256 public victimOpening;
    uint256 public reentered; // bitmask of calls that went through
    uint256 public deliverBps = 10_000;

    constructor(Arclaw b) {
        box = b;
    }

    function setVictim(uint256 id) external {
        victimOpening = id;
    }

    function setDeliver(uint256 bps) external {
        deliverBps = bps;
    }

    function buy(address stock, uint256 minSharesOut, address to) external payable {
        try box.reveal(victimOpening) {
            reentered |= 1;
        } catch {}
        try box.claimCredit() {
            reentered |= 2;
        } catch {}
        try box.retry(victimOpening) {
            reentered |= 4;
        } catch {}
        try box.returnBoxes(victimOpening) {
            reentered |= 8;
        } catch {}
        MockStock(stock).mint(to, minSharesOut * deliverBps / 10_000);
    }

    receive() external payable {}
}

/// Auditor 3a: an allow-listed desk is trusted with value, but must not be able to re-enter. Regression tests.
contract A3aDeskTest is Base {
    EvilDesk evil;

    function setUp() public override {
        super.setUp();
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.sweep(address(nvda), address(1), 100 ether);
        evil = new EvilDesk(box);
        nvda.setMinter(address(evil), true);
        box.setSink(address(evil), true);
        box.setJit(address(evil), 100, 60, uint128(5 ether), 0);
    }

    function test_deskCannotReenter() public {
        _play(bob, M1, 1);
        (uint256 bobId, uint256 bobReq) = _open(bob, M1, 1);
        vrf.fulfill(bobReq, keccak256("b"));
        evil.setVictim(bobId);

        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("a"));
        box.reveal(id);
        assertEq(evil.reentered(), 0, "every re-entry was blocked");
        assertEq(box.cardsPaid(), 3);
        assertEq(uint256(_status(bobId)), uint256(Arclaw.OpeningStatus.Fulfilled), "bob's opening untouched");
    }

    /// INFO: a desk that takes the money and short-delivers without reverting makes the house pay twice: the JIT
    /// cost is gone AND the card is refunded. The real Astock desk enforces minSharesOut, so this needs a
    /// non-conforming (or upgraded) desk; _jitBuy could revert-or-account instead of trusting it.
    function test_info_shortDeliveringDeskIsPaidAndCardRefunded() public {
        evil.setDeliver(1); // 0.01% of the shares
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("a"));
        vm.deal(address(box), 10 ether); // float
        uint256 poolBefore = address(box).balance;
        uint256 aliceBefore = alice.balance;
        box.reveal(id);
        assertEq(box.cardsRefunded(), 3);
        assertEq(alice.balance - aliceBefore, 0.75 ether, "full refund");
        assertGt(poolBefore - address(box).balance, 0.75 ether + 0.7 ether, "plus the JIT spend");
    }
}
