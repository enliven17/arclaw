// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {ArclawLinks} from "../../src/ArclawLinks.sol";
import {LuckVault, ILuck} from "../../src/LuckVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract A3aToken is ERC20 {
    constructor() ERC20("ARCLAW", "ARCLAW") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

/// A "vault" that answers with no return data (an EOA, a proxy with a fallback, the wrong contract).
contract SilentVault {
    fallback() external {}
}

/// Auditor 3a: luck vault, treasury and links edges. Documents CURRENT behaviour.
contract A3aMiscTest is Base {
    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1));
    }

    /// L-03: _boostOf promises "a missing or failing vault means no boost, never a revert", but a vault that
    /// returns empty or short data (an EOA, a wrong address, a fallback-only proxy) makes try/catch fail in the
    /// caller's ABI decode, which is not caught: every open() reverts until the owner fixes `luck`.
    function test_l03_nonConformingVaultBricksOpen() public {
        _play(alice, M1, 1);
        box.setLuck(ILuck(makeAddr("eoa")));
        vm.prank(alice);
        vm.expectRevert();
        box.open(M1, 1);

        box.setLuck(ILuck(address(new SilentVault())));
        vm.prank(alice);
        vm.expectRevert();
        box.open(M1, 1);
    }

    /// INFO: one wei staked by anyone blocks setLuckToken forever (totalStaked != 0, no admin unstake). The owner
    /// can only route around it with a new vault via Arclaw.setLuck.
    function test_info_dustStakeBlocksTokenChange() public {
        LuckVault v = new LuckVault();
        A3aToken t = new A3aToken();
        v.setLuckToken(address(t));
        t.mint(bob, 1);
        vm.startPrank(bob);
        t.approve(address(v), 1);
        v.stake(1);
        vm.stopPrank();
        vm.expectRevert(LuckVault.StakesOutstanding.selector);
        v.setLuckToken(address(0));
    }

    /// L-04: sealed (sold, not yet opened) boxes are not a liability: their revenue is free balance and the owner
    /// can withdraw it the moment it is paid. The buyer's box is then backed only by inventory and whatever float
    /// remains; machineOff or an un-repriced table (TableStale) also leaves it unopenable with no refund path.
    function test_l04_sealedBoxRevenueIsWithdrawable() public {
        uint256 start = address(box).balance;
        _play(alice, M1, 20);
        assertEq(box.freeBalance(), start + 20 ether);
        box.withdraw(address(0xBEEF), 20 ether);
        assertEq(box.balanceOf(alice, M1), 20, "alice still holds 20 boxes backed by nothing native");

        box.setMachineActive(M1, false);
        vm.prank(alice);
        vm.expectRevert(Arclaw.MachineOff.selector);
        box.open(M1, 1);
    }

    /// INFO: the link-key front-run documented in ArclawLinks costs the griefer nothing lasting: the squatting link
    /// can expire one second later and be reclaimed.
    function test_info_linkKeySquatIsCheap() public {
        address key = makeAddr("key");
        _play(alice, M1, 3);
        _play(bob, M1, 1);
        _link(bob, key, M1, 1, block.timestamp + 1); // bob front-runs alice with her pending key

        vm.prank(alice);
        vm.expectRevert(ArclawLinks.LinkKeyUsed.selector);
        box.safeTransferFrom(alice, address(links), M1, 3, abi.encode(key, block.timestamp + 1 days));

        vm.warp(block.timestamp + 2);
        vm.prank(bob);
        links.reclaimLink(0);
        assertEq(box.balanceOf(bob, M1), 1);
    }
}
