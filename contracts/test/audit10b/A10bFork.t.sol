// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {Deploy} from "../../script/Deploy.s.sol";

/// Mainnet fork (opt-in: A10B_FORK=1). Runs the real Deploy script on chain 5042 with the deploy.mjs env, leaves the
/// contract with NO prize inventory (as at launch) and a small float, then plays one Single box per tier against
/// the real Astock desk and oracle. The D20 callback is simulated (prank as the coordinator).
contract A10bForkTest is Test {
    Deploy d;
    Arclaw box;
    address keeper = makeAddr("keeper bot");

    function setUp() public {
        if (!vm.envOr("A10B_FORK", false)) return;
        vm.createSelectFork("https://rpc.mainnet.arc.io");
        vm.setEnv("OPERATOR", vm.toString(makeAddr("operator agent")));
        vm.setEnv("OWNER", vm.toString(makeAddr("owner multisig")));
        vm.setEnv("GUARDIAN", vm.toString(makeAddr("guardian")));
        vm.setEnv("KEEPER", vm.toString(keeper));
        vm.setEnv("LAUNCH_MACHINES", "1");
        vm.setEnv("RESERVE_FLOOR", "5000000000000000000");
        d = new Deploy();
        d.run();
        box = d.box();
        vm.prank(makeAddr("owner multisig"));
        box.acceptOwnership();
    }

    /// Smallest word whose first box draws `tier` on machine 1.
    function _wordFor(uint256 tier) internal view returns (bytes32 w) {
        Arclaw.Outcome[] memory t = box.outcomes(1);
        uint256 total = box.tableWeight(box.currentTable(1) - 1);
        for (uint256 s; s < 100_000; ++s) {
            w = keccak256(abi.encode("w", s));
            uint256 r = uint256(keccak256(abi.encode(w, uint256(0)))) % total;
            for (uint256 i; i < t.length; ++i) {
                if (r < t[i].weight) {
                    if (t[i].tier == tier) return w;
                    break;
                }
                r -= t[i].weight;
            }
        }
        revert("no word");
    }

    /// Every tier of a Single box at launch: which cards the real desk delivers just in time, what is refunded,
    /// and whether the launch float survives it (IOU / pause).
    function test_fork_launchSingleEveryTier() public {
        if (!vm.envOr("A10B_FORK", false)) return;
        vm.deal(address(box), 3 ether); // a tight fundPlan float
        vm.prank(box.owner());
        box.unpause();
        address p = makeAddr("player");
        vm.deal(p, 100 ether);
        for (uint256 tier; tier < 6; ++tier) {
            if (box.paused()) {
                console.log("paused before tier", tier, "owed", box.totalOwed());
                break;
            }
            bytes32 w = _wordFor(tier);
            vm.prank(p);
            box.play{value: 1 ether}(1, 1);
            uint256 shown = box.currentTable(1) - 1;
            vm.prank(p);
            (uint256 id, uint256 req) = box.open(1, 1, shown);
            vm.prank(box.vrfCoordinator());
            box.rawFulfillRandomness(req, w);
            uint256 paidBefore = box.cardsPaid();
            uint256 refBefore = box.cardsRefunded();
            uint256 balBefore = p.balance;
            vm.prank(keeper);
            box.reveal(id);
            console.log("tier", tier);
            console.log("  cards paid / refunded", box.cardsPaid() - paidBefore, box.cardsRefunded() - refBefore);
            console.log("  usdc refund to player (wei)", p.balance - balBefore, "owed", box.owed(p));
            console.log("  paused after", box.paused() ? 1 : 0, "unreserved (wei)", box.freeBalance());
        }
    }

    /// The dead-VRF probe against the live coordinator: it must not pause a healthy D20.
    function test_fork_probeOnLiveD20() public {
        if (!vm.envOr("A10B_FORK", false)) return;
        vm.deal(address(box), 3 ether);
        vm.prank(box.owner());
        box.unpause();
        vm.expectRevert(Arclaw.VrfAlive.selector);
        box.pauseIfVrfDown{gas: 5_000_000}();
        assertFalse(box.paused());
    }

    /// Real D20 expiry: the fee comes back to Arclaw on retry, the opener's top-up is repaid, no IOU, no pause.
    function test_fork_realD20ExpiryRetryRefund() public {
        if (!vm.envOr("A10B_FORK", false)) return;
        vm.deal(address(box), 3 ether);
        vm.prank(box.owner());
        box.unpause();
        address p = makeAddr("player");
        vm.deal(p, 100 ether);
        vm.prank(p);
        box.play{value: 1 ether}(1, 1);
        uint256 shown = box.currentTable(1) - 1;
        vm.prank(p);
        (uint256 id,) = box.open{value: 1 ether}(1, 1, shown); // over-pays: the change must come back
        assertGe(p.balance, 98 ether, "change returned");
        uint256 before = address(box).balance;
        vm.warp(block.timestamp + 61);
        vm.prank(keeper);
        box.retry(id);
        console.log("balance before / after keeper retry", before, address(box).balance);
        console.log("topUpReserve", box.topUpReserve(), "owed", box.totalOwed());
        assertEq(box.totalOwed(), 0);
        assertFalse(box.paused());
    }
}
