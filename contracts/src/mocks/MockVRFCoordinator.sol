// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ID20VRFConsumer, ID20VRFRefundConsumer} from "../vrf/d20/interfaces/ID20VRF.sol";
import {ID20Coordinator} from "../vrf/D20Randomness.sol";

/// @notice Unit-test stand-in for the D20 coordinator: same request, quote, getRequest, getMappedResult and
///         refundRequest surface, 60 s deadline, and a failed callback does not undo fulfillment
///         (retryCallback redelivers), matching the documented D20 behaviour.
contract MockVRFCoordinator {
    uint256 public fee = 0.02 ether;
    uint256 public nextId = 1;
    mapping(uint256 => ID20Coordinator.Request) internal _req;
    mapping(uint256 => uint256) public feePaid;

    event RandomnessRequested(
        uint256 requestId, address consumer, uint256 feePaid, address refundAddress, uint64 deadline
    );

    error IncorrectFee(uint256 expected, uint256 actual);
    error ContractConsumerRequired();
    error NotFulfilled();
    error RefundNotAvailable();
    error AlreadyFulfilled();

    function setFee(uint256 f) external {
        fee = f;
    }

    function quoteFee(uint32) external view returns (uint256) {
        return fee;
    }

    function quoteFeeAt(uint32, uint256) external view returns (uint256) {
        return fee;
    }

    function requestRandomness(bytes32 clientSeed, uint32 callbackGasLimit, address refundAddress)
        external
        payable
        returns (uint256 id)
    {
        if (msg.sender.code.length == 0) revert ContractConsumerRequired();
        if (msg.value < fee) revert IncorrectFee(fee, msg.value);
        id = nextId++;
        ID20Coordinator.Request storage r = _req[id];
        r.consumer = msg.sender;
        r.callbackGasLimit = callbackGasLimit;
        r.requestBlock = uint64(block.number);
        r.deadline = uint64(block.timestamp + 60);
        r.refundAddress = refundAddress;
        r.clientSeed = clientSeed;
        feePaid[id] = msg.value;
        emit RandomnessRequested(id, msg.sender, msg.value, refundAddress, r.deadline);
    }

    function getRequest(uint256 id) external view returns (ID20Coordinator.Request memory) {
        return _req[id];
    }

    function getMappedResult(uint256 id) external view returns (uint256[] memory out) {
        if (!_req[id].fulfilled) revert NotFulfilled();
        out = new uint256[](1);
        out[0] = uint256(_req[id].randomness);
    }

    /// Test hook: accept a word and deliver it with exactly the request's callback gas.
    function fulfill(uint256 id, bytes32 word) external returns (bool delivered) {
        ID20Coordinator.Request storage r = _req[id];
        if (r.fulfilled || r.refunded) revert AlreadyFulfilled();
        if (block.timestamp > r.deadline) revert RefundNotAvailable();
        r.fulfilled = true;
        r.randomness = word;
        delivered = _deliver(id);
    }

    /// Test hook: accept a word but run the callback with too little gas, so delivery fails.
    function fulfillStarved(uint256 id, bytes32 word) external {
        ID20Coordinator.Request storage r = _req[id];
        r.fulfilled = true;
        r.randomness = word;
        try ID20VRFConsumer(r.consumer).rawFulfillRandomness{gas: 5_000}(id, word) {} catch {}
    }

    function retryCallback(uint256 id) external returns (bool delivered) {
        ID20Coordinator.Request storage r = _req[id];
        if (!r.fulfilled || r.delivered) revert NotFulfilled();
        delivered = _deliver(id);
    }

    function refundRequest(uint256 id) external {
        ID20Coordinator.Request storage r = _req[id];
        if (r.fulfilled || r.refunded || block.timestamp <= r.deadline) revert RefundNotAvailable();
        r.refunded = true;
        (bool ok,) = r.refundAddress.call{value: feePaid[id], gas: 30_000}("");
        ok;
        try ID20VRFRefundConsumer(r.consumer).onRefund{gas: 100_000}(id) {} catch {}
    }

    function _deliver(uint256 id) internal returns (bool ok) {
        ID20Coordinator.Request storage r = _req[id];
        try ID20VRFConsumer(r.consumer).rawFulfillRandomness{gas: r.callbackGasLimit}(id, r.randomness) {
            ok = true;
            r.delivered = true;
        } catch {}
    }
}
