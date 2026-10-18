// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {ArclawLens} from "../src/ArclawLens.sol";
import {ArclawLinks} from "../src/ArclawLinks.sol";
import {LuckVault} from "../src/LuckVault.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
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

    /// Safety margin, in bps of a pack's value, for tiers sitting on the floor or the cap. The contract re-prices
    /// a table at inclusion; without slack a 1-tick oracle move between simulation and broadcast (or between an
    /// operator's quote and its transaction) would revert setPrizes with BelowFloor or AboveCap.
    uint256 constant EDGE_MARGIN_BPS = 100; // 1%
    /// Arclaw checks the floor again at open, at live prices, inside a 5% band (maxPriceMoveBps <= 500). A floor tier
    /// built 5.3% above the floor (floor / 0.95 = +5.27%) can never fall under it before the price guard trips first,
    /// so a small dip does not halt opens until the next reprice. Costs about 1 point of RTP (still inside the band).
    uint256 constant FLOOR_MARGIN_BPS = 530;

    /// One outcome per tier: a 3-card pack worth multiplier x price. A tier at (or under) the floor is built 5.3% above
    /// it and a tier at (or over) the cap 1% under it. Card amounts round up, except at the cap, where they round down.
    function buildTable(MachineCfg memory m, uint256 floorBps, address[8] memory tok, uint256[8] memory px)
        internal
        pure
        returns (Arclaw.OutcomeInput[] memory t)
    {
        t = new Arclaw.OutcomeInput[](m.tiers.length);
        uint256 price = m.priceUsdc * 1e18;
        for (uint256 k; k < m.tiers.length; ++k) {
            Tier memory tier = m.tiers[k];
            bool atCap = tier.multiplierBps >= m.capBps;
            uint256 mult = tier.multiplierBps <= floorBps
                ? floorBps * (10_000 + FLOOR_MARGIN_BPS) / 10_000
                : atCap ? m.capBps * (10_000 - EDGE_MARGIN_BPS) / 10_000 : tier.multiplierBps;
            uint256 target = price * mult / 10_000; // USDC 18 dp
            bool roundDown = atCap;
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
    function printAndWrite(Arclaw box, ArclawLens lens, string memory path) internal {
        uint256[] memory ids = box.machineIds();
        string memory out = string.concat(
            '{\n  "chainId": ', vm.toString(block.chainid), ',\n  "arclaw": "', vm.toString(address(box)),
            '",\n  "machines": ['
        );
        string memory json = vm.readFile(MACHINES);
        MachineCfg[] memory cfg = readMachines(json);
        for (uint256 i; i < ids.length; ++i) {
            out = string.concat(out, i == 0 ? "\n" : ",\n", _machine(box, lens, ids[i], _tiersOf(cfg, ids[i])));
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

    function _machine(Arclaw box, ArclawLens lens, uint256 id, Tier[] memory names)
        internal
        view
        returns (string memory s)
    {
        (uint128 price, uint16 floorBps, uint32 capBps, uint16 rtpMin, uint16 rtpMax) = box.machines(id);
        uint256 tableId = box.currentTable(id) - 1;
        (uint256 rtp, uint256 minBps, uint256 maxBps, uint256 total) = lens.stats(box, id);
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
            ',\n      "rtpBps": ', vm.toString(rtp), ',\n      "luckyRtpBps": ', vm.toString(lens.luckyRtp(box, id)), ',\n      "minPackBps": ', vm.toString(minBps),
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
///   deployed PAUSED until inventory is bought (operator `spend`) and the owner multisig unpauses.
///   OWNER=<multisig> OPERATOR=<treasury agent> forge script script/Deploy.s.sol --tc Deploy \
///     --rpc-url https://rpc.mainnet.arc.io --private-key $DEPLOYER_KEY --broadcast \
///     --with-gas-price 30gwei --priority-gas-price 1gwei --verify --verifier blockscout \
///     --verifier-url https://explorer.arc.io/api/
///   Arc drops transactions with maxFeePerGas under 20 gwei, and forge overestimates (hundreds of gwei) without
///   --with-gas-price. Afterwards the multisig calls acceptOwnership() on Arclaw and AstockPriceSource.
/// Env:
///   OWNER         final owner (multisig). Mainnet: required. Ownable2Step: it must acceptOwnership().
///   OPERATOR      treasury agent (reprices, restocks). Mainnet: required and must differ from the deployer.
///   RESERVE_FLOOR (wei, float for big wins, default 0), BOX_URI, DAILY_CAP (wei, default 50 USDC), MAX_TABLE_AGE (seconds; testnet default 30 days, mainnet 24 h),
///   POOL_USD (testnet seed per stock, USD 6 dp, default $2000), MOCK_PRICES=1 (testnet: fixed prices, no fork).
/// Deployment files (lib/deployments/arc-<chain>.json, lib/machines.resolved*.json) are written only on --broadcast.
contract Deploy is OddsWriter {
    Arclaw public box;
    ArclawLens public lens;
    ArclawLinks public links;
    LuckVault public luck;
    address public priceSource;
    address public desk;
    address public operator;
    address public owner;
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
        owner = vm.envOr("OWNER", msg.sender);
        MockPriceSource src = new MockPriceSource();
        priceSource = address(src);
        desk = address(new MockAstockDesk(IPriceSource(priceSource)));
        box = new Arclaw(vm.envOr("BOX_URI", string("")), D20_TESTNET, 0.1 ether);
        lens = new ArclawLens();
        links = new ArclawLinks(IERC1155(address(box)));

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
        // Tables live at most a day (Arclaw.MAX_TABLE_AGE): the operator must reprice testnet tables daily too.
        box.setMaxTableAge(vm.envOr("MAX_TABLE_AGE", uint256(1 days)));
        _configure();
        if (owner != msg.sender) box.transferOwnership(owner);
        vm.stopBroadcast();

        _publish("../lib/deployments/arc-testnet.json", "../lib/machines.resolved.json", D20_TESTNET);
    }

    function _mainnet() internal {
        operator = vm.envAddress("OPERATOR");
        owner = vm.envAddress("OWNER");
        vm.startBroadcast();
        require(operator != msg.sender, "OPERATOR must not be the deployer");
        require(owner != address(0) && operator != address(0), "OWNER and OPERATOR required");
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
        lens = new ArclawLens();
        links = new ArclawLinks(IERC1155(address(box)));
        box.pause(); // no inventory yet: every card would refund
        uint256 age = vm.envOr("MAX_TABLE_AGE", uint256(0));
        if (age != 0) box.setMaxTableAge(age);
        _configure();
        if (owner != msg.sender) {
            box.transferOwnership(owner);
            src.transferOwnership(owner);
        }
        vm.stopBroadcast();

        _publish("../lib/deployments/arc-mainnet.json", "../lib/machines.resolved.mainnet.json", D20_MAINNET);
        console.log("PAUSED. Owner accepts ownership; operator restocks via spend(); owner unpauses.");
    }

    /// Machines, rules and tables, all from machines.json.
    function _configure() internal {
        string memory json = vm.readFile(MACHINES);
        Policy memory p = readPolicy(json);
        MachineCfg[] memory ms = readMachines(json);
        box.setPolicy(IPriceSource(priceSource), vm.envOr("DAILY_CAP", uint256(50 ether)));
        box.setSink(desk, true);
        box.setOperator(operator);
        // The reveal bot: may reveal any opening at once (openers always can; anyone after an hour).
        box.setKeeper(vm.envOr("KEEPER", operator), true);
        // ARCLAW luck: the vault ships with no token and no tiers (boosts off) until ARCLAW exists on Arguspad.
        luck = new LuckVault();
        box.setLuck(luck);
        if (owner != msg.sender) luck.transferOwnership(owner);
        // Short cards are bought on the desk at reveal from box revenue: 1% slippage, at most 20 buys per reveal,
        // 60 USDC per card (a Vault jackpot card is ~49.5). RESERVE_FLOOR keeps a float for Epic and better.
        box.setJit(desk, 100, 20, 60 ether, vm.envOr("RESERVE_FLOOR", uint256(0)));
        for (uint256 i; i < ms.length; ++i) {
            box.setMachine(
                ms[i].id,
                uint128(ms[i].priceUsdc * 1e18),
                uint16(p.floorBps),
                uint32(ms[i].capBps),
                uint16(p.rtpMinBps),
                uint16(p.rtpMaxBps)
            );
            box.setPrizes(ms[i].id, buildTable(ms[i], p.floorBps, tokens, prices));
        }
    }

    /// Prints the odds; writes the deployment and resolved-odds files only on a real broadcast.
    function _publish(string memory depPath, string memory oddsPath, address coordinator) internal {
        bool live =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        printAndWrite(box, lens, live ? oddsPath : "");
        if (live) _write(depPath, coordinator);
        else console.log("dry run: deployment files not written");
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
        vm.serializeAddress(o, "lens", address(lens));
        vm.serializeAddress(o, "links", address(links));
        vm.serializeAddress(o, "luckVault", address(luck));
        vm.serializeAddress(o, "priceSource", priceSource);
        vm.serializeAddress(o, "desk", desk);
        vm.serializeAddress(o, "operator", operator);
        vm.serializeAddress(o, "owner", owner);
        vm.serializeUint(o, "machines", box.machineIds());
        vm.serializeAddress(o, "vrfCoordinator", coordinator);
        string memory json = vm.serializeString(o, "stocks", stocksJson);
        vm.writeJson(json, path);
    }
}

/// Prints the live odds of the Arclaw deployed on this chain (lib/deployments/arc-<chain>.json) and rewrites the
/// matching resolved-odds file (lib/machines.resolved.json on testnet, lib/machines.resolved.mainnet.json on mainnet).
///   forge script script/Deploy.s.sol --tc Odds --rpc-url https://rpc.testnet.arc.io
contract Odds is OddsWriter {
    function run() external {
        bool main = block.chainid == MAINNET;
        require(main || block.chainid == TESTNET, "unsupported chain");
        string memory dep =
            vm.readFile(main ? "../lib/deployments/arc-mainnet.json" : "../lib/deployments/arc-testnet.json");
        Arclaw box = Arclaw(payable(vm.parseJsonAddress(dep, ".arclaw")));
        ArclawLens lens = ArclawLens(vm.parseJsonAddress(dep, ".lens"));
        printAndWrite(box, lens, main ? "../lib/machines.resolved.mainnet.json" : "../lib/machines.resolved.json");
    }
}
