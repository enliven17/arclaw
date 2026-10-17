// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RandomnessSource} from "./RandomnessSource.sol";
import {D20VRFConsumer} from "./d20/D20VRFConsumer.sol";
import {ID20VRF} from "./d20/interfaces/ID20VRF.sol";

/// @notice Read side of the D20 coordinator that ID20VRF leaves out (from @d20dao/vrf-sdk abi/D20VRFCoordinator.json).
interface ID20Coordinator {
    struct Request {
        address consumer;
        uint32 callbackGasLimit;
        uint64 requestBlock;
        uint64 targetBlock;
        uint64 deadline;
        address refundAddress;
        bytes32 clientSeed;
        bytes32 mappingHash;
        bytes32 blockHash;
        bytes32 randomness;
        bytes32 proofHash;
        bytes32 transcriptHash;
        bool fulfilled;
        bool delivered;
        bool refunded;
        uint64 epochId;
        bytes32 epochHash;
    }

    function getRequest(uint256 requestId) external view returns (Request memory);
}

/// @title D20Randomness
/// @notice RandomnessSource backed by the D20DAO VRF coordinator on Arc.
///         Raw requests, refund address = this contract (expired fees come back as native USDC via receive()).
abstract contract D20Randomness is RandomnessSource, D20VRFConsumer {
    constructor(address coordinator) D20VRFConsumer(coordinator) {}

    function _quoteRandomness(uint32 callbackGasLimit) internal view override returns (uint256) {
        return ID20VRF(vrfCoordinator).quoteFee(callbackGasLimit);
    }

    function _requestRandomness(bytes32 seed, uint32 callbackGasLimit, uint256 fee)
        internal
        override
        returns (uint256)
    {
        return ID20VRF(vrfCoordinator).requestRandomness{value: fee}(seed, callbackGasLimit, address(this));
    }

    function _randomnessStatus(uint256 requestId)
        internal
        view
        override
        returns (bool fulfilled, bool expired, bytes32 word)
    {
        ID20Coordinator.Request memory r = ID20Coordinator(vrfCoordinator).getRequest(requestId);
        fulfilled = r.fulfilled;
        word = r.randomness;
        // D20 accepts a proof at or before `deadline` only; after it the request can only be refunded.
        expired = !r.fulfilled && r.deadline != 0 && block.timestamp > r.deadline;
    }

    function _fulfillRandomness(uint256 requestId, bytes32 randomness) internal override {
        _onRandomness(requestId, randomness);
    }
}
