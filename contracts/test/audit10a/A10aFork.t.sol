// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {ID20Coordinator} from "../../src/vrf/D20Randomness.sol";

/// Audit 10a, mainnet fork (opt-in: A10_FORK=1). Runs the real Deploy script with the deploy.mjs env against the
/// real D20 coordinator, Astock desk, oracle and .arc tokens.
abstract contract A10aForkBase is Test {
    Deploy d;
    Arclaw box;
    address constant D20 = 0xd20da057469C45928912d983F45790C41e290571;

    function setUp() public {
        if (!vm.envOr("A10_FORK", false)) return;
        vm.createSelectFork("https://rpc.mainnet.arc.io");
        vm.setEnv("OPERATOR", vm.toString(makeAddr("operator agent")));
        vm.setEnv("OWNER", vm.toString(makeAddr("owner multisig")));
        vm.setEnv("GUARDIAN", vm.toString(makeAddr("guardian")));
        vm.setEnv("KEEPER", vm.toString(makeAddr("keeper")));
        vm.setEnv("RESERVE_FLOOR", "5000000000000000000");
        vm.setEnv("LAUNCH_MACHINES", "1");
        d = new Deploy();
        d.run();
        box = d.box();
        address owner = box.pendingOwner() == address(0) ? box.owner() : box.pendingOwner();
        if (box.pendingOwner() != address(0)) {
            vm.prank(owner);
            box.acceptOwnership();
        }
        vm.deal(address(box), 20 ether); // float
        vm.prank(box.owner());
        box.unpause();
    }
}

contract A10aForkTest is A10aForkBase {
    /// The dead-VRF probe against the real coordinator: must revert VrfAlive while D20 serves.
    function test_fork_probeDoesNotFalsePause() public {
        if (!vm.envOr("A10_FORK", false)) return;
        vm.fee(block.basefee == 0 ? 20 gwei : block.basefee);
        address griefer = makeAddr("griefer");
        vm.prank(griefer);
        try box.pauseIfVrfDown{gas: 1_200_000}() {
            console.log("PROBE PAUSED THE CONTRACT");
        } catch (bytes memory err) {
            console.logBytes(err);
        }
        assertFalse(box.paused(), "probe paused a live D20");
    }

    /// Real D20 request layout: expiry, refund and retry on the real coordinator.
    function test_fork_expiryRetryReturnOnRealD20() public {
        if (!vm.envOr("A10_FORK", false)) return;
        address p = makeAddr("player");
        vm.deal(p, 100 ether);
        vm.startPrank(p);
        box.play{value: 2 ether}(1, 2);
        (uint256 id, uint256 req) = box.open(1, 2, box.currentTable(1) - 1);
        vm.stopPrank();
        ID20Coordinator.Request memory r = ID20Coordinator(D20).getRequest(req);
        console.log("deadline", r.deadline, "now", block.timestamp);
        vm.warp(block.timestamp + 61);
        uint256 balBefore = address(box).balance;
        vm.prank(makeAddr("keeper"));
        uint256 req2 = box.retry(id);
        console.log("retry ok, new request", req2, "bal delta (wei, signed via two logs)");
        console.log(balBefore, address(box).balance);
        r = ID20Coordinator(D20).getRequest(req);
        assertTrue(r.refunded, "old request refunded on retry");
    }

    /// A 20-box Single reveal with no inventory: 60 just-in-time buys on the real desk. Gas of the reveal.
    function test_fork_jit60RevealGas() public {
        if (!vm.envOr("A10_FORK", false)) return;
        address p = makeAddr("player");
        vm.deal(p, 100 ether);
        vm.deal(address(box), 200 ether);
        vm.startPrank(p);
        box.play{value: 20 ether}(1, 20);
        (uint256 id, uint256 req) = box.open(1, 20, box.currentTable(1) - 1);
        vm.stopPrank();
        vm.prank(D20);
        box.rawFulfillRandomness(req, keccak256("fork word 10a"));
        uint256 g = gasleft();
        vm.prank(p);
        box.reveal(id);
        uint256 used = g - gasleft();
        console.log("reveal(20) with JIT gas", used, "block gas limit", block.gaslimit);
        console.log("cards paid", box.cardsPaid(), "refunded", box.cardsRefunded());
    }

    /// Gas of one real D20 request (the probe gives it PROBE_GAS = 1M), and the probe over a range of tx gas limits.
    function test_fork_requestGasAndProbeGasSweep() public {
        if (!vm.envOr("A10_FORK", false)) return;
        vm.fee(20 gwei);
        uint256 fee = ID20VRFQ(D20).quoteFee(100_000);
        vm.deal(address(box), 50 ether);
        vm.prank(address(box));
        uint256 g = gasleft();
        ID20VRFQ(D20).requestRandomness{value: fee}(bytes32(0), 100_000, address(box));
        console.log("D20 request gas", g - gasleft());
        for (uint256 tg = 1_150_000; tg < 1_400_000; tg += 10_000) {
            vm.prank(makeAddr("griefer"));
            try box.pauseIfVrfDown{gas: tg}() {} catch {}
            assertFalse(box.paused(), "probe paused a live D20 at some gas limit");
        }
    }
}

interface ID20VRFQ {
    function quoteFee(uint32) external view returns (uint256);
    function requestRandomness(bytes32, uint32, address) external payable returns (uint256);
}

/// What the D20 owner Safe can upgrade the coordinator to: same proxy address (Arclaw's immutable vrfCoordinator), so
/// rawFulfillRandomness accepts whatever word it is handed.
contract PickingCoordinator {
    address immutable real;

    constructor(address real_) {
        real = real_;
    }

    /// Everything else behaves exactly like the real D20 logic.
    fallback() external payable {
        address r = real;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), r, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }

    receive() external payable {}

    function proxiableUUID() external pure returns (bytes32) {
        return 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    }

    function pick(address consumer, uint256 requestId, bytes32 word) external {
        (bool ok,) = consumer.call(abi.encodeWithSignature("rawFulfillRandomness(uint256,bytes32)", requestId, word));
        require(ok, "callback");
    }
}

interface IUUPS {
    function upgradeToAndCall(address impl, bytes calldata data) external payable;
    function owner() external view returns (address);
}

contract A10aD20UpgradeForkTest is A10aForkBase {
    /// L-01: the D20 coordinator is an OZ 5 UUPS proxy owned by a 2-of-2 Safe. Its owner can replace the logic and
    /// deliver chosen words, so an outcome is not only withholdable but selectable: here every box is the jackpot.
    function test_L01_d20OwnerUpgradePicksJackpots() public {
        if (!vm.envOr("A10_FORK", false)) return;
        bytes32 impl = vm.load(D20, 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc);
        assertTrue(impl != bytes32(0), "D20 coordinator is an ERC-1967 proxy");
        address d20Owner = IUUPS(D20).owner();
        assertGt(d20Owner.code.length, 0, "owner is a contract (Safe)");

        PickingCoordinator evil = new PickingCoordinator(address(uint160(uint256(impl))));
        vm.prank(d20Owner); // one Safe transaction of the D20 owner
        IUUPS(D20).upgradeToAndCall(address(evil), "");

        Arclaw.Outcome[] memory t = box.outcomes(1);
        uint256 jackpot = t.length - 1;
        uint256 start;
        for (uint256 i; i < jackpot; ++i) start += t[i].weight;
        uint256 w = box.tableWeight(box.currentTable(1) - 1);

        address p = makeAddr("colluding player");
        vm.deal(p, 100 ether);
        vm.deal(address(box), 200 ether); // revenue / float for the just-in-time buys
        uint256 got;
        for (uint256 k; k < 5; ++k) {
            vm.startPrank(p);
            box.play{value: 1 ether}(1, 1);
            (uint256 id, uint256 req) = box.open(1, 1, box.currentTable(1) - 1);
            vm.stopPrank();
            bytes32 word;
            for (uint256 s;; ++s) {
                word = keccak256(abi.encode(k, s));
                if (uint256(keccak256(abi.encode(word, uint256(0)))) % w >= start) break;
            }
            PickingCoordinator(payable(D20)).pick(address(box), req, word);
            vm.prank(p);
            box.reveal(id);
            got += t[jackpot].value;
        }
        console.log("5 USDC of plays, prize value paid (wei)", got);
        assertEq(box.cardsPaid(), 15, "every card of every jackpot paid");
        assertGt(got, 45 ether, "about 49.5 USDC out for 5 in");
    }
}
