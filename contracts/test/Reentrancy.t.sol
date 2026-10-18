// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";

/// A prize token with a transfer hook (ERC-777 style) that calls back into Arclaw mid-payout.
contract HookToken is ERC20 {
    Arclaw public target;
    uint256 public openingId;
    bool public armed;
    bool public reentered;

    constructor() ERC20("HOOK.arc", "HOOK.arc") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function arm(Arclaw t, uint256 id) external {
        (target, openingId, armed) = (t, id, true);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from == address(target)) {
            armed = false;
            target.reveal(openingId); // reverts: ReentrancyGuardReentrantCall
            reentered = true;
        }
    }
}

/// An opener that tries to re-enter when it receives a native refund, and accepts boxes.
contract GreedyOpener is IERC1155Receiver {
    Arclaw immutable box;
    uint256 public openingId;
    uint256 public attempts;

    constructor(Arclaw b) {
        box = b;
    }

    function playAndOpen() external payable {
        box.play{value: msg.value}(1, 1);
        (openingId,) = box.open(1, 1, box.currentTable(1) - 1);
    }

    receive() external payable {
        ++attempts;
        box.reveal(openingId); // reverts, so the refund push fails and becomes credit
    }

    function claim() external {
        box.claimCredit();
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}

contract ReentrancyTest is Base {
    function test_tokenHookCannotReenterReveal() public {
        HookToken hook = new HookToken();
        hook.mint(address(box), 10 ether);
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        (t[0], p[0]) = (address(hook), 200e6);
        prices.setPrices(t, p);
        _forceSingle(M1, address(hook), 0.75 ether);
        uint256 inv = hook.balanceOf(address(box));
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        hook.arm(box, id);

        vm.deal(address(box), 10 ether);
        uint256 before = alice.balance;
        box.reveal(id);
        // Every hooked transfer re-enters, hits the guard and reverts inside trySafeTransfer (rolling back the
        // hook's own state too), so each card degrades to a refund instead of a double payout or a stuck box.
        assertFalse(hook.reentered());
        assertEq(hook.balanceOf(alice), 0);
        assertEq(hook.balanceOf(address(box)), inv);
        assertEq(alice.balance, before + 0.75 ether);
        assertEq(box.cardsPaid(), 0);
        assertEq(box.cardsRefunded(), 3);
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Revealed));
    }

    function test_nativeRefundReceiverCannotReenter_getsCredit() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.sweep(address(nvda), address(1), 100 ether); // empty pool: full refund
        GreedyOpener g = new GreedyOpener(box);
        g.playAndOpen{value: P1}();
        (,,,,,, uint256 req,) = box.openings(g.openingId());
        vrf.fulfill(req, keccak256("w"));

        box.reveal(g.openingId()); // must not be blocked by a hostile opener
        assertEq(g.attempts(), 0); // receive() reverted, the attempt was rolled back
        assertEq(box.credit(address(g)), 0.75 ether);

        vm.expectRevert(Arclaw.TransferFailed.selector); // its receive() still reverts on the pull
        g.claim();
    }

    function test_vrfCallbackCannotPayOut() public {
        // The callback only stores the word: no token moves inside the coordinator's gas budget.
        box.setPrizes(M1, _table(address(nvda), P1));
        _play(alice, M1, 1);
        (, uint256 req) = _open(alice, M1, 1);
        uint256 before = nvda.balanceOf(alice);
        vrf.fulfill(req, keccak256("w"));
        assertEq(nvda.balanceOf(alice), before);
    }
}
