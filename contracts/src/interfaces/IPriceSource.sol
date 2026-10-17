// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice USD price of a stock token, 6 decimals. MockPriceSource on testnet, AstockPriceSource on mainnet.
interface IPriceSource {
    function priceOf(address token) external view returns (uint256);
}
