// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {LuckVault, ILuck} from "../src/LuckVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Vm} from "forge-std/Vm.sol";

contract Arclaw20 is ERC20 {
    constructor() ERC20("ARCLAW", "ARCLAW") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function burn(address from, uint256 a) external {
        _burn(from, a);
    }
}

/// Lends ARCLAW for the length of one call (mint, callback, burn): a stand-in for any flash loan.
contract FlashLender {
    Arclaw20 immutable token;

    constructor(Arclaw20 t) {
        token = t;
    }

    function flash(uint256 amount, bytes calldata data) external {
        token.mint(msg.sender, amount);
        FlashBorrower(payable(msg.sender)).onFlash(amount, data);
        token.burn(msg.sender, amount); // must be back
    }
}

/// Borrows ARCLAW, stakes it, opens boxes while "holding", unstakes and repays, all in one transaction.
contract FlashBorrower {
    Arclaw immutable box;
    LuckVault immutable vault;
    Arclaw20 immutable token;
    uint256 public openingId;

    constructor(Arclaw b, LuckVault v, Arclaw20 t) {
        (box, vault, token) = (b, v, t);
    }

    function attack(FlashLender lender, uint256 amount) external payable {
        box.play{value: msg.value}(1, 1);
        lender.flash(amount, "");
    }

    function onFlash(uint256 amount, bytes calldata) external {
        token.approve(address(vault), amount);
        vault.stake(amount);
        (openingId,) = box.open(1, 1);
        vault.unstake(amount);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    receive() external payable {}
}

contract LyingVault is ILuck {
    uint256 public bps;
    bool public broken;

    function set(uint256 b, bool br) external {
        (bps, broken) = (b, br);
    }

    function boostOf(address) external view returns (uint256) {
        require(!broken, "vault down");
        return bps;
    }
}

contract LuckTest is Base {
    LuckVault vault;
    Arclaw20 arclaw;
    uint256 constant K = 1e18;

    function setUp() public override {
        super.setUp();
        vault = new LuckVault();
        arclaw = new Arclaw20();
        vault.setLuckToken(address(arclaw));
        uint256[] memory mins = new uint256[](3);
        uint256[] memory bps = new uint256[](3);
        (mins[0], mins[1], mins[2]) = (1000 * K, 10_000 * K, 100_000 * K);
        (bps[0], bps[1], bps[2]) = (25, 50, 100);
        vault.setTiers(mins, bps);
        box.setLuck(vault);
        box.setPrizes(M1, _table(address(nvda), P1));
        box.setMaxTableAge(365 days); // these tests travel in time
    }

    function _stake(address who, uint256 amount) internal {
        arclaw.mint(who, amount);
        vm.startPrank(who);
        arclaw.approve(address(vault), amount);
        vault.stake(amount);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ vault

    function test_vault_boostOnlyAfterMinAge() public {
        uint256 t0 = block.timestamp;
        _stake(alice, 10_000 * K);
        assertEq(vault.boostOf(alice), 0, "fresh stake counts for nothing");
        vm.warp(t0 + 24 hours - 1);
        assertEq(vault.boostOf(alice), 0);
        vm.warp(t0 + 24 hours);
        assertEq(vault.boostOf(alice), 50);
        _stake(alice, 90_000 * K); // a top-up restarts the clock
        assertEq(vault.boostOf(alice), 0);
        vm.warp(t0 + 48 hours);
        assertEq(vault.boostOf(alice), 100);
        vm.prank(alice);
        vault.unstake(95_000 * K); // 5k left: tier 1, clock kept
        assertEq(vault.boostOf(alice), 25);
        assertEq(arclaw.balanceOf(alice), 95_000 * K);
        assertEq(vault.totalStaked(), 5000 * K);
    }

    function test_vault_belowFirstTierAndDisabled() public {
        uint256 t0 = block.timestamp;
        _stake(alice, 999 * K);
        vm.warp(t0 + 2 days);
        assertEq(vault.boostOf(alice), 0);
        uint256[] memory empty = new uint256[](0);
        vault.setTiers(empty, empty);
        _stake(bob, 100_000 * K);
        vm.warp(t0 + 4 days);
        assertEq(vault.boostOf(bob), 0, "no tiers, no boost");
    }

    function test_vault_tokenChangeOnlyWhenEmpty() public {
        _stake(alice, 1 * K);
        vm.expectRevert(LuckVault.StakesOutstanding.selector);
        vault.setLuckToken(address(0));
        vm.prank(alice);
        vault.unstake(1 * K);
        vault.setLuckToken(address(0)); // disabled
        assertEq(vault.boostOf(alice), 0);
        vm.expectRevert(LuckVault.NoToken.selector);
        vm.prank(alice);
        vault.stake(1);
    }

    function test_vault_tierAndAgeValidation() public {
        uint256[] memory mins = new uint256[](2);
        uint256[] memory bps = new uint256[](2);
        (mins[0], mins[1], bps[0], bps[1]) = (10, 5, 10, 20); // not ascending
        vm.expectRevert(LuckVault.BadTiers.selector);
        vault.setTiers(mins, bps);
        (mins[0], mins[1], bps[0], bps[1]) = (5, 10, 10, 101); // over 1%
        vm.expectRevert(LuckVault.BadTiers.selector);
        vault.setTiers(mins, bps);
        (mins[0], mins[1], bps[0], bps[1]) = (5, 10, 30, 20); // boost going down
        vm.expectRevert(LuckVault.BadTiers.selector);
        vault.setTiers(mins, bps);
        vm.expectRevert(LuckVault.BadAge.selector);
        vault.setMinAge(59 minutes);
        vault.setMinAge(6 hours);
        vm.prank(alice);
        vm.expectRevert();
        vault.setMinAge(6 hours);
    }

    function test_vault_unstakeMoreThanStaked() public {
        _stake(alice, 10 * K);
        vm.prank(alice);
        vm.expectRevert(LuckVault.NotEnough.selector);
        vault.unstake(11 * K);
    }

    // ------------------------------------------------------------------ arclaw

    function test_boostFixedAtOpenAndEmitted() public {
        uint256 t0 = block.timestamp;
        _stake(alice, 100_000 * K);
        vm.warp(t0 + 1 days);
        _play(alice, M1, 1);
        vm.recordLogs();
        (uint256 id,) = _open(alice, M1, 1);
        assertEq(box.openingBoost(id), 100);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(box) || logs[i].topics[0] != Arclaw.Opened.selector) continue;
            (,,,, uint256 boost) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, uint256));
            assertEq(boost, 100);
            seen = true;
        }
        assertTrue(seen);
        // Unstaking after the open changes nothing for that opening.
        vm.prank(alice);
        vault.unstake(100_000 * K);
        assertEq(box.openingBoost(id), 100);
    }

    function test_flashLoanGetsNoBoost() public {
        FlashLender lender = new FlashLender(arclaw);
        FlashBorrower attacker = new FlashBorrower(box, vault, arclaw);
        vm.deal(address(attacker), 10 ether);
        attacker.attack{value: P1}(lender, 1_000_000 * K);
        assertEq(box.openingBoost(attacker.openingId()), 0, "borrowed for one tx: no luck");
        assertEq(arclaw.balanceOf(address(attacker)), 0, "loan repaid");
    }

    function test_buyAndStakeRightBeforeOpenGetsNoBoost() public {
        _stake(alice, 1_000_000 * K);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12); // next block: still far from minAge
        _play(alice, M1, 1);
        (uint256 id,) = _open(alice, M1, 1);
        assertEq(box.openingBoost(id), 0);
    }

    function test_boostCappedAndVaultFailureIsHarmless() public {
        LyingVault liar = new LyingVault();
        box.setLuck(liar);
        liar.set(5000, false); // claims 50%
        _play(alice, M1, 2);
        (uint256 a,) = _open(alice, M1, 1);
        assertEq(box.openingBoost(a), box.MAX_BOOST_BPS(), "Arclaw caps any vault at 1%");
        liar.set(0, true); // vault reverts
        (uint256 b,) = _open(alice, M1, 1);
        assertEq(box.openingBoost(b), 0, "open still works");
        box.setLuck(ILuck(address(0)));
    }

    /// Boosted boxes keep the better of two draws; unboosted boxes are untouched.
    function test_boostedDrawKeepsTheBetterPack() public {
        LyingVault fixedBoost = new LyingVault();
        fixedBoost.set(100, false);
        box.setLuck(fixedBoost);
        uint256 boosted;
        uint256 upgraded;
        for (uint256 r; r < 40; ++r) {
            _play(alice, M1, 20);
            (uint256 id, uint256 req) = _open(alice, M1, 20);
            bytes32 word = keccak256(abi.encode("luck", r));
            vrf.fulfill(req, word);
            vm.recordLogs();
            box.reveal(id);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            for (uint256 i; i < logs.length; ++i) {
                if (logs[i].topics[0] != Arclaw.OutcomeDrawn.selector) continue;
                (uint256 b,, uint256 idx, uint256 value, bool lucky) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, bool));
                uint256 first = _mirrorDraw(uint256(keccak256(abi.encode(word, b))));
                bool roll = uint256(keccak256(abi.encode(word, b, "luck"))) % 10_000 < 100;
                assertEq(lucky, roll, "boost applied exactly when the luck roll hits");
                if (!lucky) {
                    assertEq(idx, first, "unboosted box draws as before");
                    continue;
                }
                ++boosted;
                uint256 alt = _mirrorDraw(uint256(keccak256(abi.encode(word, b, "luck", 1))));
                uint256 best = _value(alt) > _value(first) ? alt : first;
                assertEq(idx, best, "kept the better pack");
                assertEq(value, _value(best));
                if (best != first) ++upgraded;
            }
        }
        emit log_named_uint("boosted boxes out of 800", boosted);
        emit log_named_uint("of which upgraded", upgraded);
        assertGt(boosted, 0);
        assertLt(boosted, 30); // ~8 expected at 1%
    }

    function _mirrorDraw(uint256 rand) internal pure returns (uint256) {
        return rand % 4 < 3 ? 0 : 1; // _table: weight 3 then weight 1
    }

    function _value(uint256 idx) internal pure returns (uint256) {
        return idx == 0 ? P1 / 2 : P1 * 3 / 2;
    }

    /// The band is checked at maximum luck: a table sitting exactly on rtpMax without luck is rejected.
    function test_bandIncludesMaxBoost() public {
        box.setMachine(M1, uint128(P1), 5000, 100_000, 6000, 7500);
        // 0.5x (w3) / 1.5x (w1): EV 7500 exactly, max-boost EV 7500 + 1% x (E[max] 0.9375 - 0.75) = 7518
        Arclaw.OutcomeInput[] memory t = _table(address(nvda), P1);
        vm.expectRevert(abi.encodeWithSelector(Arclaw.RtpOutOfBand.selector, 7518));
        box.setPrizes(M1, t);
        box.setMachine(M1, uint128(P1), 5000, 100_000, 6000, 7519);
        box.setPrizes(M1, t);
        assertEq(lens.luckyRtp(box, M1), 7518);
        (uint256 rtp,,,) = lens.stats(box, M1);
        assertEq(rtp, 7500);
    }
}
