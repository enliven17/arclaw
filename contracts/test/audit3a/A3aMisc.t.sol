// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {ArclawLinks} from "../../src/ArclawLinks.sol";
import {LuckVault, ILuck} from "../../src/LuckVault.sol";
import {AstockPriceSource} from "../../src/AstockPriceSource.sol";
import {IAstockOracle} from "../../src/interfaces/IAstock.sol";
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

/// Auditor 3a: luck vault, treasury and links edges. L-03 and L-04 flipped to the FIXED behaviour; INFO unchanged.
contract A3aMiscTest is Base {
    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1));
    }

    /// L-03 fixed: the vault is read with a raw staticcall and a 32-byte return check, so an EOA, a wrong address
    /// or a fallback-only proxy as `luck` means no boost, never a bricked open().
    function test_fixed_l03_nonConformingVaultMeansNoBoost() public {
        _play(alice, M1, 2);
        box.setLuck(ILuck(makeAddr("eoa")));
        (uint256 a,) = _open(alice, M1, 1);
        assertEq(box.openingBoost(a), 0);

        box.setLuck(ILuck(address(new SilentVault())));
        (uint256 b,) = _open(alice, M1, 1);
        assertEq(box.openingBoost(b), 0);
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

    /// INFO fixed: neither the vault nor the mainnet price source can be left without an owner.
    function test_fixed_info_renounceDisabled() public {
        LuckVault v = new LuckVault();
        vm.expectRevert(LuckVault.RenounceDisabled.selector);
        v.renounceOwnership();
        AstockPriceSource ps = new AstockPriceSource(IAstockOracle(address(0)));
        vm.expectRevert(AstockPriceSource.RenounceDisabled.selector);
        ps.renounceOwnership();
        assertEq(v.owner(), address(this));
        assertEq(ps.owner(), address(this));
    }

    /// L-04 fixed: sold-but-unopened boxes are a liability. Their revenue sits in sealedReserve (out of the free
    /// balance) until the box is opened (then pendingReserve) or forever if it never is, so the owner cannot
    /// withdraw it. A machine switched off keeps its boxes sealed but fully backed.
    function test_fixed_l04_sealedBoxRevenueIsReserved() public {
        uint256 start = box.freeBalance();
        _play(alice, M1, 20);
        assertEq(box.sealedReserve(), 20 ether);
        assertEq(box.freeBalance(), start, "nothing new is free");
        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, start));
        box.withdraw(address(0xBEEF), 20 ether);

        box.setMachineActive(M1, false);
        uint256 shown = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(Arclaw.MachineOff.selector);
        box.open(M1, 1, shown);
        assertEq(box.sealedReserve(), 20 ether, "still backed while the machine is off");

        box.setMachineActive(M1, true);
        _open(alice, M1, 5);
        assertEq(box.sealedReserve(), 15 ether, "opened boxes move to pendingReserve");
        assertEq(box.pendingReserve(), 5 ether);
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
