// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAstockDesk} from "../interfaces/IAstock.sol";
import {IPriceSource} from "../interfaces/IPriceSource.sol";
import {MockStock} from "./MockStock.sol";

/// @notice Testnet Astock desk with the mainnet signature. Mints MockStock at the price source's price.
///         Must be a minter on each MockStock. Proceeds stay here, since this is a mock.
contract MockAstockDesk is IAstockDesk {
    IPriceSource public immutable prices;

    event Bought(address indexed buyer, address indexed stock, address indexed to, uint256 paid, uint256 shares);

    error Slippage();

    constructor(IPriceSource prices_) {
        prices = prices_;
    }

    function buy(address stock, uint256 minSharesOut, address to) external payable {
        // USD 18 dp divided by USD 6 dp per share gives 18 dp shares
        uint256 shares = msg.value * 1e6 / prices.priceOf(stock);
        if (shares < minSharesOut) revert Slippage();
        MockStock(stock).mint(to, shares);
        emit Bought(msg.sender, stock, to, msg.value, shares);
    }
}
