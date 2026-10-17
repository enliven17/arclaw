// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAstockDesk} from "../interfaces/IAstock.sol";
import {IPriceSource} from "../interfaces/IPriceSource.sol";
import {MockStock} from "./MockStock.sol";

/// @notice Testnet Astock desk with the mainnet signatures. Mints MockStock at the price source's price on buy; on
///         sell it takes the shares back and pays native USDC at the same price minus a spread, from its own balance
///         (fund it on deploy; it also keeps buy proceeds). Must be a minter on each MockStock for buy.
///         Mainnet signatures (checked against the live desk's bytecode): sell(address,uint256,uint256,address) and
///         quoteSell(address,uint256) returning (usdcOut, ok).
contract MockAstockDesk is IAstockDesk {
    IPriceSource public immutable prices;
    /// Sell spread in basis points, taken off the price.
    uint256 public constant SPREAD_BPS = 50;

    event Bought(address indexed buyer, address indexed stock, address indexed to, uint256 paid, uint256 shares);
    event Sold(address indexed seller, address indexed stock, address indexed to, uint256 shares, uint256 paid);

    error Slippage();
    error ZeroAmount();
    error InsufficientLiquidity();
    error TransferFailed();

    constructor(IPriceSource prices_) {
        prices = prices_;
    }

    receive() external payable {}

    function buy(address stock, uint256 minSharesOut, address to) external payable {
        // USD 18 dp divided by USD 6 dp per share gives 18 dp shares
        uint256 shares = msg.value * 1e6 / prices.priceOf(stock);
        if (shares < minSharesOut) revert Slippage();
        MockStock(stock).mint(to, shares);
        emit Bought(msg.sender, stock, to, msg.value, shares);
    }

    /// @notice Native USDC (18 dp) that selling `sharesIn` would pay now, and whether the desk can pay it.
    function quoteSell(address stock, uint256 sharesIn) public view returns (uint256 usdcOut, bool ok) {
        // 18 dp shares times USD 6 dp per share, over 1e6, gives USD 18 dp
        usdcOut = sharesIn * prices.priceOf(stock) / 1e6 * (10_000 - SPREAD_BPS) / 10_000;
        ok = usdcOut > 0 && usdcOut <= address(this).balance;
    }

    /// @notice Sell `sharesIn` of `stock` (approve this desk first); native USDC goes to `to`.
    function sell(address stock, uint256 sharesIn, uint256 minUsdcOut, address to) external {
        if (sharesIn == 0) revert ZeroAmount();
        (uint256 out, bool ok) = quoteSell(stock, sharesIn);
        if (!ok) revert InsufficientLiquidity();
        if (out < minUsdcOut) revert Slippage();
        if (!MockStock(stock).transferFrom(msg.sender, address(this), sharesIn)) revert TransferFailed();
        emit Sold(msg.sender, stock, to, sharesIn, out);
        (bool sent,) = to.call{value: out}("");
        if (!sent) revert TransferFailed();
    }
}
