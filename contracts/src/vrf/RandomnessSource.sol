// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title RandomnessSource
/// @notice The seam between the game and its randomness provider. The game only ever talks to these
///         internal functions; swapping D20 for another VRF means writing another mixin, nothing else moves.
abstract contract RandomnessSource {
    /// @dev Exact fee for a request sent in this transaction, native wei.
    function _quoteRandomness(uint32 callbackGasLimit) internal view virtual returns (uint256);

    /// @dev Send a request paying exactly `fee` from this contract's balance. Fee refunds come back here.
    function _requestRandomness(bytes32 seed, uint32 callbackGasLimit, uint256 fee)
        internal
        virtual
        returns (uint256 requestId);

    /// @dev Provider-side truth about a request.
    ///      fulfilled: the word is final (even if our callback failed to run).
    ///      expired:   not fulfilled and can never be; safe to re-request or unwind.
    function _randomnessStatus(uint256 requestId)
        internal
        view
        virtual
        returns (bool fulfilled, bool expired, bytes32 word);

    /// @dev Best effort: reclaim the fee of an expired request into this contract. Must never revert.
    function _refundRandomness(uint256 requestId) internal virtual;

    /// @dev Called by the mixin when the provider delivers. Must stay cheap.
    function _onRandomness(uint256 requestId, bytes32 word) internal virtual;
}
