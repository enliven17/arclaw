// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice What Arclaw reads at open.
interface ILuck {
    function boostOf(address player) external view returns (uint256 bps);
}

/// @title LuckVault: stake ARCLAW for a luck boost on Arclaw boxes
/// @notice A stake only counts once it has stayed in the vault for `minAge` (default 24 h); any top-up restarts the
///         clock. Balances are never read, so a flash loan, a borrowed bag or tokens parked for one block earn
///         nothing. Unstaking is instant: the boost of boxes already opened was fixed when they were opened.
///         The boost is between 0 and 1% (100 bps); Arclaw caps it again on its side.
contract LuckVault is ILuck, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BOOST_BPS = 100;
    uint256 public constant MAX_TIERS = 8;

    struct Stake {
        uint128 amount;
        uint64 since; // last deposit
    }

    /// The ARCLAW token (minted later on Arguspad). Zero = boosts disabled.
    IERC20 public token;
    uint256 public totalStaked;
    uint256 public minAge = 24 hours;
    mapping(address => Stake) public stakes;
    /// Ascending stake thresholds and their boost, e.g. [1k, 10k, 100k] -> [25, 50, 100] bps.
    uint256[] public tierMin;
    uint256[] public tierBps;

    event Staked(address indexed player, uint256 amount, uint256 total);
    event Unstaked(address indexed player, uint256 amount, uint256 total);
    event TokenSet(address token);
    event TiersSet(uint256[] minStake, uint256[] boostBps);
    event MinAgeSet(uint256 minAge);

    error NoToken();
    error StakesOutstanding();
    error BadTiers();
    error BadAge();
    error ZeroAmount();
    error NotEnough();
    error RenounceDisabled();

    constructor() Ownable(msg.sender) {}

    /// @notice Disabled: without an owner the token, tiers and age could never be set again.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------ players

    function stake(uint256 amount) external nonReentrant {
        IERC20 t = token;
        if (address(t) == address(0)) revert NoToken();
        if (amount == 0) revert ZeroAmount();
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = t.balanceOf(address(this)) - before; // fee-on-transfer safe
        Stake storage s = stakes[msg.sender];
        s.amount += SafeCast.toUint128(got);
        s.since = uint64(block.timestamp); // a top-up restarts the clock
        totalStaked += got;
        emit Staked(msg.sender, got, s.amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        Stake storage s = stakes[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > s.amount) revert NotEnough();
        s.amount -= SafeCast.toUint128(amount);
        totalStaked -= amount;
        emit Unstaked(msg.sender, amount, s.amount);
        token.safeTransfer(msg.sender, amount);
    }

    // ------------------------------------------------------------------ views

    /// @notice Boost in bps for `player` right now: 0 unless the stake is at least `minAge` old.
    function boostOf(address player) external view returns (uint256 bps) {
        if (address(token) == address(0)) return 0;
        Stake memory s = stakes[player];
        if (s.amount == 0 || block.timestamp < uint256(s.since) + minAge) return 0;
        for (uint256 i = tierMin.length; i > 0; --i) {
            if (s.amount >= tierMin[i - 1]) return tierBps[i - 1];
        }
    }

    function tiers() external view returns (uint256[] memory, uint256[] memory) {
        return (tierMin, tierBps);
    }

    // ------------------------------------------------------------------ owner

    /// @notice Point the vault at ARCLAW once it exists (or zero to disable). Only while nothing is staked, so a
    ///         change can never strand deposits of the previous token.
    function setLuckToken(address token_) external onlyOwner {
        if (totalStaked != 0) revert StakesOutstanding();
        token = IERC20(token_);
        emit TokenSet(token_);
    }

    /// @notice Ascending thresholds with non-decreasing boosts, each at most MAX_BOOST_BPS. Empty = no boosts.
    function setTiers(uint256[] calldata minStake, uint256[] calldata boostBps) external onlyOwner {
        uint256 n = minStake.length;
        if (n != boostBps.length || n > MAX_TIERS) revert BadTiers();
        for (uint256 i; i < n; ++i) {
            if (minStake[i] == 0 || boostBps[i] > MAX_BOOST_BPS) revert BadTiers();
            if (i > 0 && (minStake[i] <= minStake[i - 1] || boostBps[i] < boostBps[i - 1])) revert BadTiers();
        }
        (tierMin, tierBps) = (minStake, boostBps);
        emit TiersSet(minStake, boostBps);
    }

    /// @notice How long a stake must sit before it counts. At least 1 hour.
    function setMinAge(uint256 age) external onlyOwner {
        if (age < 1 hours || age > 30 days) revert BadAge();
        minAge = age;
        emit MinAgeSet(age);
    }
}
