// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IPriceSource} from "./interfaces/IPriceSource.sol";
import {IAstockOracle} from "./interfaces/IAstock.sol";

/// @title AstockPriceSource
/// @notice IPriceSource for Arc mainnet: maps each .arc token to the Robinhood Chain underlying the Astock oracle
///         prices, and returns that price (USD, 6 dp). Reverts on a stale feed. Prices tables and caps refunds.
contract AstockPriceSource is IPriceSource, Ownable2Step {
    IAstockOracle public immutable oracle;
    /// .arc token => Robinhood Chain underlying
    mapping(address => address) public underlyingOf;

    event UnderlyingSet(address indexed token, address indexed underlying);

    error Unmapped(address token);
    error Unpriced(address token);
    error Stale(address token);
    error LengthMismatch();

    constructor(IAstockOracle oracle_) Ownable(msg.sender) {
        oracle = oracle_;
    }

    function setUnderlyings(address[] calldata tokens, address[] calldata underlyings) external onlyOwner {
        if (tokens.length != underlyings.length) revert LengthMismatch();
        for (uint256 i; i < tokens.length; ++i) {
            underlyingOf[tokens[i]] = underlyings[i];
            emit UnderlyingSet(tokens[i], underlyings[i]);
        }
    }

    function priceOf(address token) external view returns (uint256 price) {
        address u = underlyingOf[token];
        if (u == address(0)) revert Unmapped(token);
        if (oracle.isStale(u)) revert Stale(token);
        price = oracle.getPrice(u);
        if (price == 0) revert Unpriced(token);
    }
}
