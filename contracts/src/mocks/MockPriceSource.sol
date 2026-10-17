// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceSource} from "../interfaces/IPriceSource.sol";

/// @notice Testnet price source: owner (or relayer) copies mainnet Astock oracle prices here. USD, 6 dp.
contract MockPriceSource is IPriceSource, Ownable {
    mapping(address => uint256) internal _price;
    address public relayer;

    event PriceSet(address indexed token, uint256 price);

    error NotRelayer();
    error Unpriced(address token);

    constructor() Ownable(msg.sender) {}

    function setRelayer(address r) external onlyOwner {
        relayer = r;
    }

    function setPrices(address[] calldata tokens, uint256[] calldata prices) external {
        if (msg.sender != owner() && msg.sender != relayer) revert NotRelayer();
        for (uint256 i; i < tokens.length; ++i) {
            _price[tokens[i]] = prices[i];
            emit PriceSet(tokens[i], prices[i]);
        }
    }

    function priceOf(address token) external view returns (uint256 p) {
        p = _price[token];
        if (p == 0) revert Unpriced(token);
    }
}
