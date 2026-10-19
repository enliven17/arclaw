// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {LuckVault} from "../../src/LuckVault.sol";
import {ILuck} from "../../src/LuckVault.sol";
import {AstockPriceSource} from "../../src/AstockPriceSource.sol";
import {IPriceSource} from "../../src/interfaces/IPriceSource.sol";
import {IAstockOracle} from "../../src/interfaces/IAstock.sol";
import {MockStock} from "../../src/mocks/MockStock.sol";

/// Astock oracle stand-in: owner-set prices, never stale.
contract A8bOracle is IAstockOracle {
    mapping(address => uint256) public px;

    function set(address u, uint256 p) external {
        px[u] = p;
    }

    function getPrice(address u) external view returns (uint256) {
        return px[u];
    }

    function isStale(address) external pure returns (bool) {
        return false;
    }
}

/// Independent audit 8b (round 5, commit 32e6f07): whole-system economics and adversarial roles.
/// Absolute warps only (via_ir re-reads block.timestamp). T0 is 16:00 UTC.
contract A8bFindingsTest is Base {
    uint256 constant T0 = 1_800_000_000;
    uint256 constant DAY0 = T0 / 1 days;

    receive() external payable {}

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1)); // 0.5x (w3) / 1.5x (w1), priced at T0
    }

    // ------------------------------------------------------------------ helpers

    /// A word whose box 0 draws outcome `idx` of the 2-outcome _table (weights 3, 1).
    function _wordFor(uint256 idx) internal pure returns (bytes32 w) {
        for (uint256 i = 1;; ++i) {
            w = bytes32(i);
            uint256 r = uint256(keccak256(abi.encode(w, uint256(0)))) % 4;
            if ((idx == 1) == (r >= 3)) return w;
        }
    }

    function _misses() internal view returns (uint256 m) {
        uint32 day;
        (day, m,,,) = box.limits();
        if (day != block.timestamp / 1 days) m = 0;
    }

    // ================================================================== M-01

    /// M-01: one IOU that is never claimed kept re-pausing the whole contract (`_settle` paused whenever
    /// totalOwed != 0, and only the IOU holder can bring it down). Fixed in round 6: `_settle` pauses only when it
    /// creates a new IOU or the unreserved balance is under minBuffer. The runbook still works: the IOU pauses, the
    /// owner funds it and unpauses, and later reveals no longer pause while the funded IOU stays unclaimed.
    function test_fixed_M01_dormantIouNoLongerRepauses() public {
        // launch-like: no float, no JIT, inventory short for the big pack
        box.setJit(address(0), 0, 0, 0, 0);
        vm.deal(address(box), 0);
        box.sweep(address(nvda), address(this), nvda.balanceOf(address(box)));

        _play(alice, M1, 1);
        uint256 tid = box.currentTable(M1) - 1;
        uint256 fee = vrf.fee();
        vm.prank(alice);
        (uint256 id, uint256 req) = box.open{value: fee}(M1, 1, tid); // no float: alice pays the fee
        vrf.fulfill(req, _wordFor(1)); // the 1.5x pack, all three cards short
        vm.prank(alice);
        box.reveal(id);
        uint256 iou = box.owed(alice);
        assertGt(iou, 0, "alice holds an IOU");
        assertTrue(box.paused(), "IOU pauses");

        // runbook: owner sends native until the IOU is claimable, restocks, unpauses
        (bool ok,) = address(box).call{value: 10 ether}("");
        assertTrue(ok);
        nvda.mint(address(box), 100 ether);
        box.unpause();
        uint256 res = box.reservedCredit() + box.pendingReserve() + box.sealedReserve() + box.topUpReserve();
        assertGe(address(box).balance, res + iou, "the IOU is fully backed and claimable");

        // alice never claims (dormant wallet, lost key, a contract opener without claimOwed, or spite)
        for (uint256 round; round < 3; ++round) {
            _play(bob, M1, 1);
            (uint256 b, uint256 rb) = _open(bob, M1, 1);
            vrf.fulfill(rb, _wordFor(0)); // small pack, fully paid in stock
            box.reveal(b);
            assertFalse(box.paused(), "FIXED: a funded old IOU does not re-pause");
            assertEq(box.owed(alice), iou);
        }
        // alice can still claim in full whenever she comes back
        vm.prank(alice);
        box.claimOwed(alice);
        assertEq(box.totalOwed(), 0);
    }

    /// Contrast: once the holder claims, reveals stop pausing.
    function test_M01_contrast_claimedIouStopsThePauses() public {
        box.setJit(address(0), 0, 0, 0, 0);
        vm.deal(address(box), 0);
        box.sweep(address(nvda), address(this), nvda.balanceOf(address(box)));
        _play(alice, M1, 1);
        uint256 tid = box.currentTable(M1) - 1;
        uint256 fee = vrf.fee();
        vm.prank(alice);
        (uint256 id, uint256 req) = box.open{value: fee}(M1, 1, tid);
        vrf.fulfill(req, _wordFor(1));
        vm.prank(alice);
        box.reveal(id);
        (bool ok,) = address(box).call{value: 10 ether}("");
        assertTrue(ok);
        nvda.mint(address(box), 100 ether);
        vm.prank(alice);
        box.claimOwed(alice);
        box.unpause();
        _play(bob, M1, 1);
        (uint256 b, uint256 rb) = _open(bob, M1, 1);
        vrf.fulfill(rb, _wordFor(0));
        box.reveal(b);
        assertFalse(box.paused());
    }

    // ================================================================== M-02

    /// M-02 (round 5 regression): a breaker trip WHILE PAUSED restarted the pause clock (`_clock()` only checked
    /// `resumedAt + SERVICE_RESET`, not whether a pause was running). Fixed in round 6: `_clock` is a no-op while
    /// paused. Two batches of maxMisses returns during the pause leave pausedSince alone, bob refunds at once.
    function test_fixed_M02_tripWhilePausedKeepsPauseClock() public {
        uint256 n = 20; // two batches of maxMisses (10)
        _play(alice, M1, n);
        uint256[] memory ids = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            (ids[i],) = _open(alice, M1, 1); // D20 is down: none of these is ever fulfilled
        }
        _play(bob, M1, 1); // an ordinary holder who wants out

        vm.warp(T0 + 100);
        box.pause(); // guardian, VRF down
        assertEq(box.pausedSince(), T0 + 100);

        // the operator keeps the table fresh, so only the pause clock decides
        vm.warp(T0 + 100 + 3 days);
        box.setPrizes(M1, _table(address(nvda), P1));
        assertEq(box.sealedRefundAt(M1), T0 + 100 + 3 days, "refundSealed is open");

        // batch 1: ten returns trip the breaker while paused
        for (uint256 i; i < 10; ++i) {
            vm.prank(alice);
            box.returnBoxes(ids[i]);
        }
        uint256 t1 = T0 + 100 + 3 days;
        assertTrue(box.paused(), "still paused the whole time");
        assertEq(_misses(), 10, "the breaker tripped");
        assertEq(box.pausedSince(), T0 + 100, "FIXED: pause clock kept");
        assertEq(box.sealedRefundAt(M1), T0 + 100 + 3 days);

        // batch 2, three days later: still the pause's clock
        vm.warp(t1 + 3 days);
        box.setPrizes(M1, _table(address(nvda), P1));
        for (uint256 i = 10; i < 20; ++i) {
            vm.prank(alice);
            box.returnBoxes(ids[i]);
        }
        assertEq(box.pausedSince(), T0 + 100, "FIXED: kept again");
        uint256 b0 = bob.balance;
        vm.prank(bob);
        box.refundSealed(M1, 1);
        assertEq(bob.balance - b0, P1);
        assertEq(box.balanceOf(alice, M1), n);
    }

    /// Contrast (round 4 behaviour the fix should restore): the same returns while paused but under the breaker
    /// limit leave the clock alone, and bob can leave.
    function test_M02_contrast_belowLimitClockKept() public {
        _play(alice, M1, 9);
        uint256[] memory ids = new uint256[](9);
        for (uint256 i; i < 9; ++i) {
            (ids[i],) = _open(alice, M1, 1);
        }
        _play(bob, M1, 1);
        vm.warp(T0 + 100);
        box.pause();
        vm.warp(T0 + 100 + 3 days);
        box.setPrizes(M1, _table(address(nvda), P1));
        for (uint256 i; i < 9; ++i) {
            vm.prank(alice);
            box.returnBoxes(ids[i]);
        }
        assertEq(box.pausedSince(), T0 + 100);
        vm.prank(bob);
        box.refundSealed(M1, 1);
    }

    // ================================================================== L-01

    /// L-01 (round 5 trade-off): retry then return books ONE miss for TWO dropped words. The withholder (D20 key or a
    /// censoring validator, colluding with the opener) drops word 1, the keeper retries (miss booked), drops word 2,
    /// returns the boxes the next day once the table aged out (nothing booked) and reopens for word 3. The breaker
    /// therefore bounds about 2 x maxMisses rejected words a day, not maxMisses; per opening it is up to 20 boxes.
    /// Not changed (round 6), kept as a characterization test: documented in the Arclaw NatSpec and
    /// docs/SECURITY.md (about 2 x (maxMisses - 1) re-rolls a day).
    function test_documented_L01_oneMissBuysTwoDroppedWords() public {
        box.setLimits(2000 ether, 1); // one miss closes opens for the day
        _play(alice, M1, 1);
        (uint256 id, uint256 r1) = _open(alice, M1, 1); // word 1: withheld
        vm.warp(T0 + 61);
        uint256 r2 = box.retry(id); // keeper; the opening's miss
        assertEq(_misses(), 1);
        // word 2: withheld too. Next UTC day, table aged out, operator reprices
        vm.warp(T0 + 1 days + 120);
        box.setPrizes(M1, _table(address(nvda), P1));
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(_misses(), 0, "the second dropped word books nothing");
        (, uint256 r3) = _open(alice, M1, 1); // a third independent word, breaker open
        assertTrue(r3 != r1 && r3 != r2);
    }

    // ================================================================== L-02

    /// L-02: a machine Deploy switches off at launch (Stack, Vault on mainnet) kept its off clock from the deploy, so
    /// refundSealed on it was open at once for its first day of service. Fixed in round 6: switching on a machine
    /// that never sold a box drops its off clock (no box of it exists, the clock protected nobody).
    function test_fixed_L02_offAtDeployMachineNotRefundableOnFirstDay() public {
        box.setPrizes(M2, _table(address(nvda), P2));
        box.setMachineActive(M2, false); // Deploy: not in LAUNCH_MACHINES
        vm.warp(T0 + 30 days);
        box.setPrizes(M2, _table(address(nvda), P2)); // operator reprices, owner launches Stack
        box.setMachineActive(M2, true);
        assertEq(box.boxesSold(M2), 0, "never sold a box while off");
        _play(alice, M2, 3);
        // only the table clock is left: priced now, stale after maxTableAge, refundable 3 days later
        assertEq(box.sealedRefundAt(M2), T0 + 30 days + 1 days + 3 days, "FIXED: no clock from the deploy");
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotExpired.selector);
        box.refundSealed(M2, 3);
    }

    // ================================================================== INFO

    /// INFO-01: on mainnet the price source is AstockPriceSource, owned by the same owner. setUnderlyings remaps or
    /// unmaps any card token at once, unpaused and without the setPolicy hold, so the round 5 guard on setPolicy
    /// (7a M-02 / 7b L-01) is a no-op against the owner key: opens halt while the table counts as fresh and no
    /// pause clock runs. Covered by the stated owner-trust assumption; the guard should not be read as a control.
    /// Not changed (round 6), kept as a characterization test: documented in docs/SECURITY.md (the Safe delay
    /// module must cover the price source's owner calls too).
    function test_documented_INFO01_priceSourceRemapBypassesSetPolicyGuard() public {
        A8bOracle oracle = new A8bOracle();
        AstockPriceSource src = new AstockPriceSource(IAstockOracle(address(oracle)));
        address uN = makeAddr("NVDA underlying");
        oracle.set(uN, 200e6);
        address[] memory t = new address[](1);
        address[] memory u = new address[](1);
        (t[0], u[0]) = (address(nvda), uN);
        src.setUnderlyings(t, u);
        box.pause();
        box.setPolicy(IPriceSource(address(src)), 50 ether);
        box.setPrizes(M1, _table(address(nvda), P1));
        vm.warp(T0 + 5 days + 1);
        box.unpause(); // past the swap hold
        box.setPrizes(M1, _table(address(nvda), P1));
        uint256 before = box.resumedAt();

        u[0] = address(0);
        src.setUnderlyings(t, u); // owner, unpaused: unmap NVDA
        _play(alice, M1, 1);
        uint256 tid = box.currentTable(M1) - 1;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AstockPriceSource.Unmapped.selector, address(nvda)));
        box.open(M1, 1, tid);
        assertFalse(box.paused());
        assertEq(box.resumedAt(), before, "no hold, no clock");
    }

    // ================================================================== verified sound

    /// Sound: LuckVault ignores fresh stake. A whale (or a flash loan) staking in the open's block gets 0; an aged
    /// stake gets its tier; a top-up restarts the clock; Arclaw caps any vault answer at MAX_BOOST_BPS.
    function test_sound_luckIsFlashResistantAndCapped() public {
        LuckVault v = new LuckVault();
        MockStock arc = new MockStock("ARCLAW");
        v.setLuckToken(address(arc));
        uint256[] memory mins = new uint256[](1);
        uint256[] memory bps = new uint256[](1);
        (mins[0], bps[0]) = (1000 ether, 100);
        v.setTiers(mins, bps);
        box.setLuck(ILuck(address(v)));
        arc.mint(alice, 2000 ether);
        vm.startPrank(alice);
        arc.approve(address(v), type(uint256).max);
        v.stake(1000 ether);
        vm.stopPrank();
        _play(alice, M1, 2);
        (uint256 a,) = _open(alice, M1, 1);
        assertEq(box.openingBoost(a), 0, "same-block stake: no boost");
        vm.warp(T0 + 1 days);
        box.setPrizes(M1, _table(address(nvda), P1));
        vm.prank(alice);
        v.stake(1); // top-up restarts the clock
        (uint256 b,) = _open(alice, M1, 1);
        assertEq(box.openingBoost(b), 0, "top-up restarts the clock");
        assertEq(v.boostOf(alice), 0);
        vm.warp(T0 + 2 days + 1);
        assertEq(v.boostOf(alice), 100);
    }

    /// Sound: refundSealed pays exactly the machine price, and returnBoxes puts the price back into sealedReserve, so
    /// no exit path pays more than was paid; the reserves always add up to what players paid in.
    function test_sound_exitsPayExactlyThePrice() public {
        _play(alice, M1, 2);
        (uint256 id,) = _open(alice, M1, 1);
        assertEq(box.sealedReserve() + box.pendingReserve(), 2 * P1);
        vm.warp(T0 + 1 days + 61);
        vm.prank(alice);
        box.returnBoxes(id);
        assertEq(box.sealedReserve(), 2 * P1);
        vm.warp(T0 + 4 days + 1); // table stale 3 days
        uint256 a0 = alice.balance;
        vm.prank(alice);
        box.refundSealed(M1, 2);
        assertEq(alice.balance - a0, 2 * P1);
        assertEq(box.sealedReserve(), 0);
    }
}
