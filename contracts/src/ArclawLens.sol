// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Arclaw} from "./Arclaw.sol";
import {ID20VRF} from "./vrf/d20/interfaces/ID20VRF.sol";

/// @title ArclawLens
/// @notice Stateless read helpers kept out of Arclaw to stay under the 24 KB code limit. Deploy once, point it at any
///         Arclaw. Nothing here is trusted by Arclaw itself.
contract ArclawLens {
    /// @notice Realised odds of a machine's current table, in bps of the price that table was validated against:
    ///         expected value, smallest and largest pack, plus the total weight. Zeros if no table.
    function stats(Arclaw box, uint256 machineId)
        external
        view
        returns (uint256 rtpBps, uint256 minBps, uint256 maxBps, uint256 totalWeight)
    {
        uint256 t = box.currentTable(machineId);
        if (t == 0) return (0, 0, 0, 0);
        uint256 price = box.tablePrice(t - 1);
        Arclaw.Outcome[] memory o = box.outcomes(machineId);
        uint256 ev;
        minBps = type(uint256).max;
        for (uint256 i; i < o.length; ++i) {
            uint256 v = o[i].value;
            totalWeight += o[i].weight;
            ev += v * o[i].weight;
            uint256 bps = v * 10_000 / price;
            if (bps < minBps) minBps = bps;
            if (bps > maxBps) maxBps = bps;
        }
        if (totalWeight == 0 || price == 0) return (0, 0, 0, 0);
        rtpBps = ev * 10_000 / totalWeight / price;
    }

    /// @notice Exact VRF fee for one open (valid inside a transaction; via eth_call the base fee may read 0, so
    ///         wallets should quote coordinator.quoteFeeAt(callbackGasLimit, latest baseFee) plus a buffer).
    function quoteVrfFee(Arclaw box) external view returns (uint256) {
        return ID20VRF(box.vrfCoordinator()).quoteFee(box.callbackGasLimit());
    }

    /// @notice RTP of a machine's current table at the maximum luck boost (bps of the table price): with
    ///         probability MAX_BOOST_BPS/10000 a box keeps the better of two draws. Arclaw keeps this inside the band.
    function luckyRtp(Arclaw box, uint256 machineId) external view returns (uint256) {
        uint256 t = box.currentTable(machineId);
        if (t == 0) return 0;
        uint256 price = box.tablePrice(t - 1);
        Arclaw.Outcome[] memory o = box.outcomes(machineId);
        uint256 w;
        uint256 ev;
        uint256 pairs;
        for (uint256 i; i < o.length; ++i) {
            w += o[i].weight;
            ev += uint256(o[i].value) * o[i].weight;
            for (uint256 j; j < o.length; ++j) {
                uint256 hi = o[i].value > o[j].value ? o[i].value : o[j].value;
                pairs += uint256(o[i].weight) * o[j].weight * hi;
            }
        }
        if (w == 0 || price == 0) return 0;
        uint256 q = box.MAX_BOOST_BPS();
        return ((10_000 - q) * ev * w + q * pairs) / w / w / price;
    }
}
