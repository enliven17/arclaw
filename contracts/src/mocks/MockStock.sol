// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Testnet stand-in for an Astock .arc token (18 decimals). Owner and approved minters mint.
contract MockStock is ERC20, Ownable {
    mapping(address => bool) public minters;

    error NotMinter();

    constructor(string memory symbol_) ERC20(symbol_, symbol_) Ownable(msg.sender) {}

    function setMinter(address m, bool allowed) external onlyOwner {
        minters[m] = allowed;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != owner() && !minters[msg.sender]) revert NotMinter();
        _mint(to, amount);
    }
}
