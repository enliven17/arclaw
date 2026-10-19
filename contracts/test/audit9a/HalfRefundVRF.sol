// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ID20VRFConsumer, ID20VRFRefundConsumer} from "../../src/vrf/d20/interfaces/ID20VRF.sol";
import {ID20Coordinator} from "../../src/vrf/D20Randomness.sol";

/// Audit 9a: MockVRFCoordinator with the SAME storage layout, but an expired request refunds only half its fee
/// (D20 refundBps >= 50%, as Arclaw.returnBoxes' NatSpec allows). Etched over the Base mock's address.
contract HalfRefundVRF {
    uint256 public fee = 0.02 ether;
    uint256 public nextId = 1;
    mapping(uint256 => ID20Coordinator.Request) internal _req;
    mapping(uint256 => uint256) public feePaid;

    error IncorrectFee(uint256 expected, uint256 actual);
    error NotFulfilled();
    error RefundNotAvailable();
    error AlreadyFulfilled();

    function quoteFee(uint32) external view returns (uint256) {
        return fee;
    }

    function requestRandomness(bytes32 clientSeed, uint32 callbackGasLimit, address refundAddress)
        external
        payable
        returns (uint256 id)
    {
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
    }

    function getRequest(uint256 id) external view returns (ID20Coordinator.Request memory) {
        return _req[id];
    }

    function getMappedResult(uint256 id) external view returns (uint256[] memory out) {
        if (!_req[id].fulfilled) revert NotFulfilled();
        out = new uint256[](1);
        out[0] = uint256(_req[id].randomness);
    }

    function fulfill(uint256 id, bytes32 word) external {
        ID20Coordinator.Request storage r = _req[id];
        if (r.fulfilled || r.refunded) revert AlreadyFulfilled();
        if (block.timestamp > r.deadline) revert RefundNotAvailable();
        r.fulfilled = true;
        r.randomness = word;
        try ID20VRFConsumer(r.consumer).rawFulfillRandomness{gas: r.callbackGasLimit}(id, word) {
            r.delivered = true;
        } catch {}
    }

    function refundRequest(uint256 id) external {
        ID20Coordinator.Request storage r = _req[id];
        if (r.fulfilled || r.refunded || block.timestamp <= r.deadline) revert RefundNotAvailable();
        r.refunded = true;
        (bool ok,) = r.refundAddress.call{value: feePaid[id] / 2, gas: 30_000}(""); // half back
        ok;
        try ID20VRFRefundConsumer(r.consumer).onRefund{gas: 100_000}(id) {} catch {}
    }

    receive() external payable {}
}
