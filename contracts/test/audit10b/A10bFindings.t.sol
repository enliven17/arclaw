// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {LuckVault} from "../../src/LuckVault.sol";
import {MockStock} from "../../src/mocks/MockStock.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/// A transferable smart account (stands in for a Safe, an ERC-6551 token-bound account or any ownable wallet).
contract StakeAccount is ERC1155Holder {
    address public owner;

    constructor(address o) {
        owner = o;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "owner");
        _;
    }

    function transferOwnership(address o) external onlyOwner {
        owner = o;
    }

    function exec(address to, uint256 value, bytes calldata data) external payable onlyOwner returns (bytes memory r) {
        bool ok;
        (ok, r) = to.call{value: value}(data);
        require(ok, "exec");
    }

    receive() external payable {}
}

contract A10bFindings is Base {
    LuckVault vault;
    MockStock arclawToken;

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1));
        vault = new LuckVault();
        arclawToken = new MockStock("ARCLAW");
        vault.setLuckToken(address(arclawToken));
        uint256[] memory mins = new uint256[](1);
        uint256[] memory bps = new uint256[](1);
        (mins[0], bps[0]) = (1000 ether, 100);
        vault.setTiers(mins, bps);
        box.setLuck(vault);
    }

    /// INFO-01: an aged LuckVault position is not bound to a person. A stake held by a transferable account keeps
    /// its `since`; selling the account hands the buyer a full boost at once, with tokens they never held for minAge.
    /// Same economics as the accepted boost renting (the RTP band is checked at MAX_BOOST_BPS), so no house loss,
    /// but the product rule "freshly bought tokens must not count" does not hold against a bought position.
    function test_info01_agedStakeSoldWithItsAccount() public {
        StakeAccount acct = new StakeAccount(alice);
        arclawToken.mint(address(acct), 1000 ether);
        vm.startPrank(alice);
        acct.exec(address(arclawToken), 0, abi.encodeCall(IERC20.approve, (address(vault), 1000 ether)));
        acct.exec(address(vault), 0, abi.encodeCall(LuckVault.stake, (1000 ether)));
        vm.stopPrank();
        vm.warp(block.timestamp + 24 hours);
        assertEq(vault.boostOf(address(acct)), 100, "aged stake");

        // the reprice keeps the table fresh after the warp
        box.setPrizes(M1, _table(address(nvda), P1));

        // Bob buys the account (an off-chain or NFT sale) and opens at once, never having held ARCLAW himself
        vm.prank(alice);
        acct.transferOwnership(bob);
        assertEq(arclawToken.balanceOf(bob), 0);
        _play(bob, M1, 1);
        vm.prank(bob);
        box.safeTransferFrom(bob, address(acct), M1, 1, "");
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(bob);
        bytes memory r = acct.exec(address(box), 0, abi.encodeCall(Arclaw.open, (M1, 1, tid)));
        (uint256 openingId,) = abi.decode(r, (uint256, uint256));
        assertEq(box.openingBoost(openingId), 100, "full boost on a position bought a block ago");
    }
}
