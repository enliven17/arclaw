// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {AstockPriceSource} from "../src/AstockPriceSource.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {MockPriceSource} from "../src/mocks/MockPriceSource.sol";
import {MockAstockDesk} from "../src/mocks/MockAstockDesk.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {IAstockOracle} from "../src/interfaces/IAstock.sol";

/// Chain constants, the featured stock list and the machines.json reader.
/// Odds, multipliers, prices and rules come ONLY from ../lib/machines.json.
abstract contract ArcConfig is Script {
    uint256 constant MAINNET = 5042;
    uint256 constant TESTNET = 5042002;
    string constant MAINNET_RPC = "https://rpc.mainnet.arc.io";
    string constant MACHINES = "../lib/machines.json";

    address constant D20_MAINNET = 0xd20da057469C45928912d983F45790C41e290571;
    address constant D20_TESTNET = 0xd20DA0FF9087d053f0291524Eac12abA1ADBd945;
    address constant ASTOCK_DESK = 0x3Ac68FC2ad55599Fa528FEfA1F05Cc1C1Df26D69;
    IAstockOracle constant ASTOCK_ORACLE = IAstockOracle(0x77905f095FA62FC472e56f17BDC039DC764C1595);

    /// Field order is alphabetical: that is how forge decodes JSON objects.
    struct Tier {
        uint256 multiplierBps;
        string name;
        uint256 weight;
    }

    struct MachineCfg {
        uint256 id;
        string name;
        uint256 priceUsdc;
        uint256 capBps;
        Tier[] tiers;
    }

    struct Policy {
        uint256 floorBps;
        uint256 rtpMinBps;
        uint256 rtpMaxBps;
    }

    // NVDA TSLA AAPL AMZN META GOOGL SPY QQQ (pandock/web/src/config.ts FEATURED)
    function symbols() internal pure returns (string[8] memory) {
        return ["NVDA.arc", "TSLA.arc", "AAPL.arc", "AMZN.arc", "META.arc", "GOOGL.arc", "SPY.arc", "QQQ.arc"];
    }

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

    /// Pack composition per tier index (stock indices into symbols() and % split of the pack value).
    /// Small tiers spread across index funds and megacaps; the top tiers feature NVDA, TSLA and META.
    function packOf(uint256 tier) internal pure returns (uint8[3] memory s, uint8[3] memory pct) {
        if (tier == 0) return ([6, 7, 2], [40, 30, 30]); // SPY QQQ AAPL
        if (tier == 1) return ([3, 5, 6], [40, 30, 30]); // AMZN GOOGL SPY
        if (tier == 2) return ([2, 4, 7], [40, 30, 30]); // AAPL META QQQ
        if (tier == 3) return ([1, 3, 5], [50, 25, 25]); // TSLA AMZN GOOGL
        if (tier == 4) return ([4, 0, 2], [50, 30, 20]); // META NVDA AAPL
        return ([0, 1, 4], [50, 30, 20]); // NVDA TSLA META
    }

    function readPolicy(string memory json) internal pure returns (Policy memory p) {
        p.floorBps = vm.parseJsonUint(json, ".policy.floorBps");
        p.rtpMinBps = vm.parseJsonUint(json, ".policy.rtpMinBps");
        p.rtpMaxBps = vm.parseJsonUint(json, ".policy.rtpMaxBps");
        require(vm.parseJsonUint(json, ".policy.cardsPerBox") == 3, "cardsPerBox must be 3");
    }

    function readMachines(string memory json) internal view returns (MachineCfg[] memory ms) {
        uint256 n;
        while (vm.keyExistsJson(json, string.concat(".machines[", vm.toString(n), "]"))) ++n;
        ms = new MachineCfg[](n);
        for (uint256 i; i < n; ++i) {
            string memory k = string.concat(".machines[", vm.toString(i), "]");
            ms[i].id = vm.parseJsonUint(json, string.concat(k, ".id"));
            ms[i].name = vm.parseJsonString(json, string.concat(k, ".name"));
            ms[i].priceUsdc = vm.parseJsonUint(json, string.concat(k, ".priceUsdc"));
            ms[i].capBps = vm.parseJsonUint(json, string.concat(k, ".capBps"));
            ms[i].tiers = abi.decode(vm.parseJson(json, string.concat(k, ".tiers")), (Tier[]));
        }
    }

    /// One outcome per tier: a 3-card pack worth multiplier x price. Card amounts round up (so a pack never dips
    /// under its multiplier and the floor holds) except for a tier at the cap, which rounds down.
    function buildTable(MachineCfg memory m, address[8] memory tok, uint256[8] memory px)
        internal
        pure
        returns (Arclaw.OutcomeInput[] memory t)
    {
        t = new Arclaw.OutcomeInput[](m.tiers.length);
        uint256 price = m.priceUsdc * 1e18;
        for (uint256 k; k < m.tiers.length; ++k) {
            Tier memory tier = m.tiers[k];
            uint256 target = price * tier.multiplierBps / 10_000; // USDC 18 dp
            bool roundDown = tier.multiplierBps >= m.capBps;
            (uint8[3] memory s, uint8[3] memory pct) = packOf(k);
            uint256 left = target;
            t[k].weight = uint88(tier.weight);
            t[k].tier = uint8(k);
            for (uint256 c; c < 3; ++c) {
                uint256 v = c == 2 ? left : target * pct[c] / 100;
                left -= v;
                uint256 p = px[s[c]];
                // value = amount * p * 1e12 / 1e18  =>  amount = value * 1e6 / p
                uint256 amount = roundDown ? v * 1e6 / p : (v * 1e6 + p - 1) / p;
                t[k].tokens[c] = tok[s[c]];
                t[k].amounts[c] = amount;
            }
        }
    }

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
}

/// Reads the live tables back from the contract: prints realised RTP, floor and cap per machine and writes
/// ../lib/machines.resolved.json for the site's odds section.
abstract contract OddsWriter is ArcConfig {
    function printAndWrite(Arclaw box, string memory path) internal {
        uint256[] memory ids = box.machineIds();
        string memory out = string.concat(
            '{\n  "chainId": ', vm.toString(block.chainid), ',\n  "arclaw": "', vm.toString(address(box)),
            '",\n  "machines": ['
        );
        string memory json = vm.readFile(MACHINES);
        MachineCfg[] memory cfg = readMachines(json);
        for (uint256 i; i < ids.length; ++i) {
            out = string.concat(out, i == 0 ? "\n" : ",\n", _machine(box, ids[i], _tiersOf(cfg, ids[i])));
        }
        out = string.concat(out, "\n  ]\n}\n");
        if (bytes(path).length > 0) vm.writeFile(path, out);
    }

    function _tiersOf(MachineCfg[] memory cfg, uint256 id) internal pure returns (Tier[] memory) {
        for (uint256 i; i < cfg.length; ++i) {
            if (cfg[i].id == id) return cfg[i].tiers;
        }
        revert("machine not in machines.json");
    }

    function _machine(Arclaw box, uint256 id, Tier[] memory names) internal view returns (string memory s) {
        (uint128 price, uint16 floorBps, uint32 capBps, uint16 rtpMin, uint16 rtpMax) = box.machines(id);
        uint256 tableId = box.currentTable(id) - 1;
        (uint256 rtp, uint256 minBps, uint256 maxBps, uint256 total) = box.tableStats(tableId);
        console.log("machine", id, "price (USDC)", price / 1e18);
        console.log("  realised RTP bps", rtp, "band", string.concat(vm.toString(rtpMin), "..", vm.toString(rtpMax)));
        console.log("  smallest pack bps", minBps, "floor", floorBps);
        console.log("  largest pack bps", maxBps, "cap", capBps);
        s = string.concat(
            '    {\n      "id": ', vm.toString(id), ',\n      "priceUsdc": "', _dec(price, 18, 2),
            '",\n      "priceWei": "', vm.toString(uint256(price)), '",\n      "tableId": ', vm.toString(tableId)
        );
        s = string.concat(
            s,
            ',\n      "rtpBps": ', vm.toString(rtp), ',\n      "minPackBps": ', vm.toString(minBps),
            ',\n      "maxPackBps": ', vm.toString(maxBps), ',\n      "rules": { "floorBps": ', vm.toString(uint256(floorBps)),
            ', "capBps": ', vm.toString(uint256(capBps))
        );
        s = string.concat(
            s,
            ', "rtpMinBps": ', vm.toString(uint256(rtpMin)), ', "rtpMaxBps": ', vm.toString(uint256(rtpMax)),
            ' },\n      "totalWeight": ', vm.toString(total), ',\n      "tiers": ['
        );
        Arclaw.Outcome[] memory t = box.outcomes(id);
        for (uint256 k; k < t.length; ++k) {
            string memory nm = t[k].tier < names.length ? names[t[k].tier].name : "Tier";
            s = string.concat(s, k == 0 ? "\n" : ",\n", _tier(t[k], nm, total, price));
            console.log(
                string.concat(
                    "  ", nm, "  p=", _dec(uint256(t[k].weight) * 1e6 / total, 4, 2), "%  value=",
                    _dec(t[k].value, 18, 4), " USDC  x", _dec(uint256(t[k].value) * 10_000 / price, 4, 2)
                )
            );
        }
        s = string.concat(s, "\n      ]\n    }");
    }

    function _tier(Arclaw.Outcome memory o, string memory nm, uint256 total, uint256 price)
        internal
        view
        returns (string memory s)
    {
        s = string.concat(
            '        {\n          "name": "', nm, '",\n          "tier": ', vm.toString(uint256(o.tier)),
            ',\n          "weight": ', vm.toString(uint256(o.weight)), ',\n          "probabilityPct": "',
            _dec(uint256(o.weight) * 1e6 / total, 4, 4)
        );
        s = string.concat(
            s,
            '",\n          "valueUsdc": "', _dec(o.value, 18, 6), '",\n          "valueWei": "', vm.toString(uint256(o.value)),
            '",\n          "multiplier": "', _dec(uint256(o.value) * 10_000 / price, 4, 4), '",\n          "cards": ['
        );
        for (uint256 c; c < 3; ++c) {
            Arclaw.Card memory cd = o.cards[c];
            s = string.concat(
                s,
                c == 0 ? "\n" : ",\n",
                '            { "ticker": "', IERC20Metadata(cd.token).symbol(), '", "token": "', vm.toString(cd.token),
                '", "amount": "', vm.toString(cd.amount), '", "valueUsdc": "', _dec(cd.value, 18, 6), '" }'
            );
        }
        s = string.concat(s, "\n          ]\n        }");
    }

    /// Fixed-point decimal string: `v` with `scale` decimals, cut to `places`.
    function _dec(uint256 v, uint256 scale, uint256 places) internal pure returns (string memory) {
        uint256 unit = 10 ** scale;
        uint256 frac = (v % unit) / 10 ** (scale - places);
        string memory f = vm.toString(frac);
        while (bytes(f).length < places) f = string.concat("0", f);
        return string.concat(vm.toString(v / unit), ".", f);
    }
}

/// Testnet (5042002): mocks + seeded inventory + live D20 testnet coordinator.
///   forge script script/Deploy.s.sol --tc Deploy --rpc-url https://rpc.testnet.arc.io --private-key $PRIVATE_KEY \
///     --broadcast --with-gas-price 30gwei --priority-gas-price 1gwei
/// Mainnet (5042): AstockPriceSource + Arclaw on the real coordinator and desk, tables priced from the live oracle,
///   deployed PAUSED until inventory is bought (operator `spend`) and the owner unpauses.
/// Env: OPERATOR (default deployer), BOX_URI, DAILY_CAP (wei, default 50 USDC), POOL_USD (testnet seed per stock,
///   USD 6 dp, default $2000), MOCK_PRICES=1 (testnet: skip the mainnet fork, use fixed prices).
contract Deploy is OddsWriter {
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
        uint256 pool = vm.envOr("POOL_USD", uint256(2000e6));

        vm.startBroadcast();
        operator = vm.envOr("OPERATOR", msg.sender);
        MockPriceSource src = new MockPriceSource();
        priceSource = address(src);
        desk = address(new MockAstockDesk(IPriceSource(priceSource)));
        box = new Arclaw(vm.envOr("BOX_URI", string("")), D20_TESTNET, 0.1 ether);

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
        _configure();
        vm.stopBroadcast();

        printAndWrite(box, "../lib/machines.resolved.json");
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
        box = new Arclaw(vm.envOr("BOX_URI", string("")), D20_MAINNET, 0.05 ether);
        box.pause(); // no inventory yet: every card would refund
        _configure();
        vm.stopBroadcast();

        printAndWrite(box, ""); // print only; the resolved file tracks the testnet deployment
        console.log("PAUSED. Fund inventory via spend(), then unpause().");
    }

    /// Machines, rules and tables, all from machines.json.
    function _configure() internal {
        string memory json = vm.readFile(MACHINES);
        Policy memory p = readPolicy(json);
        MachineCfg[] memory ms = readMachines(json);
        box.setPolicy(IPriceSource(priceSource), vm.envOr("DAILY_CAP", uint256(50 ether)));
        box.setSink(desk, true);
        box.setOperator(operator);
        for (uint256 i; i < ms.length; ++i) {
            box.setMachine(
                ms[i].id,
                uint128(ms[i].priceUsdc * 1e18),
                uint16(p.floorBps),
                uint32(ms[i].capBps),
                uint16(p.rtpMinBps),
                uint16(p.rtpMaxBps)
            );
            box.setPrizes(ms[i].id, buildTable(ms[i], tokens, prices));
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
        vm.serializeUint(o, "machines", box.machineIds());
        vm.serializeAddress(o, "vrfCoordinator", coordinator);
        string memory json = vm.serializeString(o, "stocks", stocksJson);
        vm.writeJson(json, path);
    }
}

/// Prints the live odds of a deployed Arclaw and rewrites ../lib/machines.resolved.json.
///   forge script script/Deploy.s.sol --tc Odds --rpc-url https://rpc.testnet.arc.io
contract Odds is OddsWriter {
    function run() external {
        string memory dep = vm.readFile("../lib/deployments/arc-testnet.json");
        Arclaw box = Arclaw(payable(vm.parseJsonAddress(dep, ".arclaw")));
        printAndWrite(box, block.chainid == TESTNET ? "../lib/machines.resolved.json" : "");
    }
}
