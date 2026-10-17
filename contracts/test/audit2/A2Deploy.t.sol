// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {AstockPriceSource} from "../../src/AstockPriceSource.sol";
import {ArcConfig, Deploy} from "../../script/Deploy.s.sol";
import {ID20Coordinator} from "../../src/vrf/D20Randomness.sol";

contract ConfigHarness is ArcConfig {
    function d20Main() external pure returns (address) {
        return D20_MAINNET;
    }

    function desk() external pure returns (address) {
        return ASTOCK_DESK;
    }

    function oracle() external pure returns (address) {
        return address(ASTOCK_ORACLE);
    }

    function tokens() external pure returns (address[8] memory) {
        return mainnetTokens();
    }

    function unders() external pure returns (address[8] memory) {
        return underlyings();
    }
}

/// Offline: the deploy script's mainnet constants match CLAUDE.md and pandock/web/src/config.ts.
contract A2DeployConstantsTest is Test {
    function test_mainnetConstants() public {
        ConfigHarness c = new ConfigHarness();
        assertEq(c.d20Main(), 0xd20da057469C45928912d983F45790C41e290571, "D20 mainnet coordinator");
        assertEq(c.desk(), 0x3Ac68FC2ad55599Fa528FEfA1F05Cc1C1Df26D69, "Astock v2 desk");
        assertEq(c.oracle(), 0x77905f095FA62FC472e56f17BDC039DC764C1595, "Astock oracle");
        // pandock/web/src/config.ts STOCKS (token -> underlying), FEATURED order NVDA TSLA AAPL AMZN META GOOGL SPY QQQ
        address[8] memory tok = [
            0x0A2dd7160De0c452ED4642d498162550Fe2165f2,
            0x349dcB3a576813FFbAB4B88547A0D694eb20EB18,
            0xdC79A6e977Eb1668B6BFF7aC788053305ffF13C9,
            0x468B1D1f51c8EC186172C2386a0BED6Bcf99aDD8,
            0xEb88c032788bc9aDc4671C10C19b95F9B93A2E37,
            0x5606e025C05Dd41EA485b19490632E09F3ec03B8,
            0x8645EB2EF4D5A7c46212EB7688547442126c7b48,
            0xC2017F980b6b3f1D149541cF692c1971e53383D4
        ];
        address[8] memory und = [
            0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC,
            0x322F0929c4625eD5bAd873c95208D54E1c003b2d,
            0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9,
            0x12f190a9F9d7D37a250758b26824B97CE941bF54,
            0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35,
            0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3,
            0x117cc2133c37B721F49dE2A7a74833232B3B4C0C,
            0xD5f3879160bc7c32ebb4dC785F8a4F505888de68
        ];
        address[8] memory t = c.tokens();
        address[8] memory u = c.unders();
        for (uint256 i; i < 8; ++i) {
            assertEq(t[i], tok[i], "token");
            assertEq(u[i], und[i], "underlying");
        }
    }
}

/// Mainnet fork (opt-in: A2_FORK=1): runs the real Deploy script on chain 5042 and drives the deployment
/// against the real D20 coordinator, Astock desk, oracle and .arc tokens. No broadcast leaves the fork.
contract A2DeployForkTest is Test {
    Deploy d;
    Arclaw box;

    function setUp() public {
        if (!vm.envOr("A2_FORK", false)) return;
        vm.createSelectFork("https://rpc.mainnet.arc.io");
        vm.setEnv("OPERATOR", vm.toString(makeAddr("operator agent")));
        vm.setEnv("OWNER", vm.toString(makeAddr("owner multisig")));
        d = new Deploy();
        d.run();
        box = d.box();
    }

    function test_fork_mainnetDeployState() public {
        if (!vm.envOr("A2_FORK", false)) return;
        assertEq(block.chainid, 5042);
        assertTrue(box.paused(), "deployed paused");
        assertEq(box.vrfCoordinator(), 0xd20da057469C45928912d983F45790C41e290571);
        assertTrue(box.sinks(0x3Ac68FC2ad55599Fa528FEfA1F05Cc1C1Df26D69), "desk allow-listed");
        assertEq(address(box.priceSource()), d.priceSource());
        console.log("owner   ", box.owner());
        console.log("operator", box.operator());
        console.log("dailyCap", box.dailyCap());
        console.log("subsidy ", box.maxVrfSubsidy());
        AstockPriceSource src = AstockPriceSource(d.priceSource());
        for (uint256 m = 1; m <= 3; ++m) {
            (uint128 price,,,,) = box.machines(m);
            assertEq(price, [uint128(1 ether), 5 ether, 10 ether][m - 1], "18 dp price");
            assertGt(box.currentTable(m), 0, "table set");
        }
        assertEq(src.underlyingOf(0x0A2dd7160De0c452ED4642d498162550Fe2165f2), 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC);
    }

    /// Restock through the real desk, then play/open against the real D20, simulate the coordinator's
    /// callback and reveal: proves the desk delivers to Arclaw and .arc tokens transfer to a fresh player.
    function test_fork_restockPlayOpenReveal() public {
        if (!vm.envOr("A2_FORK", false)) return;
        address owner = box.owner();
        address op = box.operator();
        vm.deal(address(box), 60 ether);
        address[8] memory tok = [
            0x0A2dd7160De0c452ED4642d498162550Fe2165f2,
            0x349dcB3a576813FFbAB4B88547A0D694eb20EB18,
            0xdC79A6e977Eb1668B6BFF7aC788053305ffF13C9,
            0x468B1D1f51c8EC186172C2386a0BED6Bcf99aDD8,
            0xEb88c032788bc9aDc4671C10C19b95F9B93A2E37,
            0x5606e025C05Dd41EA485b19490632E09F3ec03B8,
            0x8645EB2EF4D5A7c46212EB7688547442126c7b48,
            0xC2017F980b6b3f1D149541cF692c1971e53383D4
        ];
        for (uint256 i; i < 8; ++i) {
            vm.prank(op);
            try box.spend(0x3Ac68FC2ad55599Fa528FEfA1F05Cc1C1Df26D69, tok[i], 5 ether, 1) returns (uint256 got) {
                console.log("bought", i, got);
            } catch (bytes memory err) {
                console.log("spend reverted for token index", i);
                console.logBytes(err);
            }
        }
        vm.prank(owner);
        box.unpause();

        address p = makeAddr("fresh player");
        vm.deal(p, 100 ether);
        vm.prank(p);
        box.play{value: 20 ether}(1, 20);
        uint256 fee = d.lens().quoteVrfFee(box);
        console.log("vrf fee in tx", fee);
        vm.prank(p);
        (uint256 id, uint256 req) = box.open(1, 20);
        ID20Coordinator.Request memory r = ID20Coordinator(box.vrfCoordinator()).getRequest(req);
        assertEq(r.deadline, block.timestamp + 60, "D20 deadline = now + 60 s (unix seconds)");
        assertEq(r.refundAddress, address(box));

        vm.prank(box.vrfCoordinator());
        box.rawFulfillRandomness(req, keccak256("fork word"));
        uint256 g = gasleft();
        box.reveal(id);
        console.log("reveal(20) gas on fork", g - gasleft());
        console.log("cards paid", box.cardsPaid(), "refunded", box.cardsRefunded());
        assertGt(box.cardsPaid(), 0, ".arc tokens transfer to a fresh EOA");
    }
}
