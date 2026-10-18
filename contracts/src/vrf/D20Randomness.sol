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
    function refundRequest(uint256 requestId) external;
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

    /// getRequest read without a revert path: a call that reverts or answers short (dead, paused, upgraded or
    /// misbehaving coordinator) counts as lost, and so does an unfulfilled request with no deadline. Reads `fulfilled`
    /// and `deadline` straight from the 17-word static return, no returndata copy.
    function _randomnessLost(uint256 requestId) internal view override returns (bool) {
        bytes memory data = abi.encodeCall(ID20Coordinator.getRequest, (requestId));
        address c = vrfCoordinator;
        bool ok;
        uint256 size;
        uint256 deadline;
        uint256 fulfilled;
        assembly ("memory-safe") {
            let out := mload(0x40)
            ok := staticcall(gas(), c, add(data, 0x20), mload(data), out, 0x220)
            size := returndatasize()
            deadline := mload(add(out, 0x80)) // word 4
            fulfilled := mload(add(out, 0x180)) // word 12
        }
        if (!ok || size < 0x220) return true;
        return fulfilled == 0 && (deadline == 0 || block.timestamp > deadline);
    }

    /// Quote and request with `gasLimit` each. A balance under the fee proves nothing (false). On success the request
    /// is real: the caller reverts the transaction (Arclaw.pauseIfVrfDown), so it never persists.
    /// Raw calls (code size): quoteFee(uint32) 0xc9caa0c3, requestRandomness(bytes32,uint32,address) 0x9849d1e5.
    /// A quote that reverts or answers short counts as down; no returndata is copied beyond one word.
    function _randomnessDown(uint32 callbackGasLimit, uint256 gasLimit) internal override returns (bool down) {
        address c = vrfCoordinator;
        assembly ("memory-safe") {
            let p := mload(0x40)
            mstore(p, shl(224, 0xc9caa0c3))
            mstore(add(p, 0x04), callbackGasLimit)
            down := 1
            let ok := staticcall(gasLimit, c, p, 0x24, 0x00, 0x20) // own statement: Yul evaluates args right to left
            if and(ok, gt(returndatasize(), 0x1f)) {
                let fee := mload(0x00)
                down := 0
                if iszero(gt(fee, selfbalance())) {
                    mstore(p, shl(224, 0x9849d1e5))
                    mstore(add(p, 0x04), 0)
                    mstore(add(p, 0x24), callbackGasLimit)
                    mstore(add(p, 0x44), address())
                    down := iszero(call(gasLimit, c, fee, p, 0x64, 0x00, 0x00))
                }
            }
        }
    }

    /// D20 pays the escrowed fee back to the refund address (this contract) once the deadline has passed.
    /// Anyone may call it; a failure (already refunded, not enough gas) is ignored.
    function _refundRandomness(uint256 requestId) internal override {
        try ID20Coordinator(vrfCoordinator).refundRequest(requestId) {} catch {}
    }

    function _fulfillRandomness(uint256 requestId, bytes32 randomness) internal override {
        _onRandomness(requestId, randomness);
    }
}
