// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {AstockPriceSource} from "../src/AstockPriceSource.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {MockPriceSource} from "../src/mocks/MockPriceSource.sol";
import {MockAstockDesk} from "../src/mocks/MockAstockDesk.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {IAstockOracle} from "../src/interfaces/IAstock.sol";

/// Shared constants: the eight featured stocks (pandock/web/src/config.ts FEATURED) and the prize design.
abstract contract ArcConfig is Script {
    uint256 constant MAINNET = 5042;
    uint256 constant TESTNET = 5042002;
    string constant MAINNET_RPC = "https://rpc.mainnet.arc.io";

    address constant D20_MAINNET = 0xd20da057469C45928912d983F45790C41e290571;
    address constant D20_TESTNET = 0xd20DA0FF9087d053f0291524Eac12abA1ADBd945;
    address constant ASTOCK_DESK = 0x3Ac68FC2ad55599Fa528FEfA1F05Cc1C1Df26D69;
    IAstockOracle constant ASTOCK_ORACLE = IAstockOracle(0x77905f095FA62FC472e56f17BDC039DC764C1595);

    uint256 constant BOX_PRICE = 1 ether; // 1 USDC native (18 dp)

    // Per-card tiers, same for every stock: common $0.10 (70%), uncommon $0.30 (20%), rare $1 (8%),
    // legendary $2 (2%). EV per card = (7 + 6 + 8 + 4) / 100 = $0.25, so a 3-card $1 box pays 75% on average.
    function tierUsd() internal pure returns (uint256[4] memory) {
        return [uint256(100_000), 300_000, 1_000_000, 2_000_000]; // USD 6 dp
    }

    function tierWeight() internal pure returns (uint88[4] memory) {
        return [uint88(70), 20, 8, 2];
    }

    function symbols() internal pure returns (string[8] memory) {
        return ["NVDA.arc", "TSLA.arc", "AAPL.arc", "AMZN.arc", "META.arc", "GOOGL.arc", "SPY.arc", "QQQ.arc"];
    }

    /// Mainnet .arc tokens (Astock v2).
    function mainnetTokens() internal pure returns (address[8] memory) {
        return [
            0x0A2dd7160De0c452ED4642d498162550Fe2165f2,
            0x349dcB3a576813FFbAB4B88547A0D694eb20EB18,
            0xdC79A6e977Eb1668B6BFF7aC788053305ffF13C9,
            0x468B1D1f51c8EC186172C2386a0BED6Bcf99aDD8,
            0xEb88c032788bc9aDc4671C10C19b95F9B93A2E37,
            0x5606e025C05Dd41EA485b19490632E09F3ec03B8,
            0x8645EB2EF4D5A7c46212EB7688547442126c7b48,
            0xC2017F980b6b3f1D149541cF692c1971e53383D4
        ];
    }

    /// Robinhood Chain underlyings the Astock oracle prices, same order.
    function underlyings() internal pure returns (address[8] memory) {
        return [
            0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC,
            0x322F0929c4625eD5bAd873c95208D54E1c003b2d,
            0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9,
            0x12f190a9F9d7D37a250758b26824B97CE941bF54,
            0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35,
            0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3,
            0x117cc2133c37B721F49dE2A7a74833232B3B4C0C,
            0xD5f3879160bc7c32ebb4dC785F8a4F505888de68
        ];
    }

    /// Live Astock oracle prices from mainnet (read-only fork), USD 6 dp.
    function livePrices() internal returns (uint256[8] memory p) {
        address[8] memory u = underlyings();
        uint256 home = vm.activeFork();
        vm.createSelectFork(MAINNET_RPC);
        for (uint256 i; i < 8; ++i) {
            p[i] = ASTOCK_ORACLE.getPrice(u[i]);
            require(p[i] > 0, "no oracle price");
        }
        vm.selectFork(home);
    }

    /// Tier-major 32-entry table, so the first eight rows are eight different stocks.
    function buildTable(address[8] memory tok, uint256[8] memory px) internal pure returns (Arclaw.Prize[] memory t) {
        uint256[4] memory usd = tierUsd();
        uint88[4] memory w = tierWeight();
        t = new Arclaw.Prize[](32);
        for (uint256 k; k < 4; ++k) {
            for (uint256 i; i < 8; ++i) {
                // forge-lint: disable-next-line(unsafe-typecast)
                t[k * 8 + i] = Arclaw.Prize(tok[i], w[k], uint8(k), usd[k] * 1e18 / px[i]);
            }
        }
    }
}

/// Testnet (5042002): mocks + seeded inventory + live D20 testnet coordinator.
///   forge script script/Deploy.s.sol --tc Deploy --rpc-url https://rpc.testnet.arc.io --private-key $PRIVATE_KEY --broadcast
/// Mainnet (5042): AstockPriceSource + Arclaw on the real coordinator/desk, table from live oracle prices,
///   deployed PAUSED until inventory is bought (operator `spend`) and the owner unpauses.
/// Env: OPERATOR (default deployer), BOX_URI, DAILY_CAP (wei, default 50 USDC), POOL_USD (testnet seed per stock,
///   USD 6 dp, default $500), MOCK_PRICES=1 (testnet: skip the mainnet fork, use fixed prices).
contract Deploy is ArcConfig {
    // storage, not locals: keeps run() under the stack limit
    Arclaw public box;
    address public priceSource;
    address public desk;
    address public operator;
    address[8] public tokens;
    uint256[8] public prices;

    function run() external {
        if (block.chainid == TESTNET) _testnet();
        else if (block.chainid == MAINNET) _mainnet();
        else revert("unsupported chain");
    }

    function _testnet() internal {
        if (vm.envOr("MOCK_PRICES", false)) {
            prices = [uint256(180e6), 250e6, 230e6, 220e6, 700e6, 190e6, 650e6, 560e6];
        } else {
            prices = livePrices();
        }
        uint256 pool = vm.envOr("POOL_USD", uint256(500e6));

        vm.startBroadcast();
        operator = vm.envOr("OPERATOR", msg.sender);
        MockPriceSource src = new MockPriceSource();
        priceSource = address(src);
        desk = address(new MockAstockDesk(IPriceSource(priceSource)));
        box = new Arclaw(BOX_PRICE, vm.envOr("BOX_URI", string("")), D20_TESTNET, 0.1 ether);

        string[8] memory sym = symbols();
        address[] memory list = new address[](8);
        uint256[] memory px = new uint256[](8);
        for (uint256 i; i < 8; ++i) {
            MockStock s = new MockStock(sym[i]);
            s.setMinter(desk, true);
            s.mint(address(box), pool * 1e18 / prices[i]);
            tokens[i] = address(s);
            (list[i], px[i]) = (address(s), prices[i]);
        }
        src.setPrices(list, px);
        src.setRelayer(operator);

        box.setPolicy(IPriceSource(priceSource), 7000, 8000, vm.envOr("DAILY_CAP", uint256(50 ether)));
        box.setSink(desk, true);
        box.setOperator(operator);
        box.setPrizes(buildTable(tokens, prices));
        vm.stopBroadcast();

        _log();
        _write("../lib/deployments/arc-testnet.json", D20_TESTNET);
    }

    function _mainnet() internal {
        vm.startBroadcast();
        operator = vm.envOr("OPERATOR", msg.sender);
        AstockPriceSource src = new AstockPriceSource(ASTOCK_ORACLE);
        priceSource = address(src);
        desk = ASTOCK_DESK;
        tokens = mainnetTokens();
        address[8] memory u = underlyings();
        address[] memory t = new address[](8);
        address[] memory un = new address[](8);
        for (uint256 i; i < 8; ++i) {
            (t[i], un[i]) = (tokens[i], u[i]);
        }
        src.setUnderlyings(t, un);
        for (uint256 i; i < 8; ++i) {
            prices[i] = src.priceOf(tokens[i]);
        }

        box = new Arclaw(BOX_PRICE, vm.envOr("BOX_URI", string("")), D20_MAINNET, 0.05 ether);
        box.pause(); // no inventory yet: every card would refund
        box.setPolicy(IPriceSource(priceSource), 7000, 8000, vm.envOr("DAILY_CAP", uint256(50 ether)));
        box.setSink(desk, true);
        box.setOperator(operator);
        box.setPrizes(buildTable(tokens, prices));
        vm.stopBroadcast();

        _log();
        console.log("PAUSED. Fund inventory via spend(), then unpause().");
    }

    function _log() internal view {
        console.log("chainId", block.chainid);
        console.log("Arclaw", address(box));
        console.log("priceSource", priceSource);
        console.log("desk", desk);
        console.log("operator", operator);
        console.log("payout bps", box.payoutBps(box.prizes()));
        string[8] memory sym = symbols();
        for (uint256 i; i < 8; ++i) {
            console.log(sym[i], tokens[i], prices[i]);
        }
    }

    function _write(string memory path, address coordinator) internal {
        string memory s = "stocks";
        string memory stocksJson;
        string[8] memory sym = symbols();
        for (uint256 i; i < 8; ++i) {
            stocksJson = vm.serializeAddress(s, sym[i], tokens[i]);
        }
        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "deployBlock", block.number); // lower bound for indexers
        vm.serializeAddress(o, "arclaw", address(box));
        vm.serializeAddress(o, "priceSource", priceSource);
        vm.serializeAddress(o, "desk", desk);
        vm.serializeAddress(o, "operator", operator);
        vm.serializeAddress(o, "vrfCoordinator", coordinator);
        vm.serializeUint(o, "boxPrice", BOX_PRICE);
        string memory json = vm.serializeString(o, "stocks", stocksJson);
        vm.writeJson(json, path);
    }
}
