// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Astock v2 desk on Arc mainnet (0x3ac68fc2ad55599fa528fefa1f05cc1c1df26d69, EIP-1967 proxy).
///         Pays native USDC (18 dp), delivers `stock` (.arc ERC-20) to `to`.
interface IAstockDesk {
    function buy(address stock, uint256 minSharesOut, address to) external payable;
}

/// @notice Astock oracle on Arc mainnet (0x77905f095fa62fc472e56f17bdc039dc764c1595).
///         Prices the Robinhood Chain underlying, USD 6 dp.
interface IAstockOracle {
    function getPrice(address underlying) external view returns (uint256);
}
