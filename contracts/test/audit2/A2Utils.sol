// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Arclaw} from "../../src/Arclaw.sol";

/// Smart account that accepts boxes but rejects native USDC (no receive/fallback).
contract RejectingWallet {
    function call(address target, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }
}

library A2Draw {
    /// Mirror of Arclaw._draw over a ghost copy of the table weights.
    function draw(uint256[] memory weights, uint256 total, bytes32 word, uint256 b) internal pure returns (uint256) {
        uint256 r = uint256(keccak256(abi.encode(word, b))) % total;
        for (uint256 i; i < weights.length; ++i) {
            if (r < weights[i]) return i;
            r -= weights[i];
        }
        revert("unreachable");
    }
}
