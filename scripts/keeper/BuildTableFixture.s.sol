// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Compiled inside a throwaway copy of contracts/ by scripts/keeper/fixture.ts (never inside contracts/ itself), so
// this import resolves against that copy's script/ folder.
import {ArcConfig} from "../script/Deploy.s.sol";
import {Arclaw} from "../src/Arclaw.sol";

/// Runs Deploy.s.sol's own buildTable over machines.json at a few price vectors and writes every outcome to
/// ../lib/buildTable.sol.json, the reference the TypeScript port (lib/keeper/table.ts) is tested against.
contract BuildTableFixture is ArcConfig {
    function run() external {
        string memory json = vm.readFile(MACHINES);
        Policy memory p = readPolicy(json);
        MachineCfg[] memory ms = readMachines(json);
        address[8] memory tok;
        for (uint256 i; i < 8; ++i) {
            tok[i] = address(uint160(0x1000 + i));
        }
        uint256[8][4] memory sets = [
            // Deploy.s.sol MOCK_PRICES
            [uint256(180e6), 250e6, 230e6, 220e6, 700e6, 190e6, 650e6, 560e6],
            // lib/stocks.ts snapshot 2026-10-17
            [uint256(214_180000), 353_100000, 343_210000, 250_190000, 710_510000, 338_750000, 763_670000, 710_140000],
            // odd values: rounding edges
            [uint256(12_345), 99_999_999, 1_000_001, 777_777_777, 3, 250_000_000_000, 50_000, 314_159_265],
            // a 4.9% dip of the snapshot
            [uint256(203_685180), 335_798100, 326_392710, 237_930690, 675_695010, 322_151250, 726_250170, 675_343140]
        ];
        string memory out = '{\n  "sets": [';
        for (uint256 s; s < sets.length; ++s) {
            out = string.concat(out, s == 0 ? "\n" : ",\n", _set(ms, p.floorBps, tok, sets[s]));
        }
        out = string.concat(out, "\n  ]\n}\n");
        vm.writeFile("../lib/buildTable.sol.json", out);
    }

    function _set(MachineCfg[] memory ms, uint256 floorBps, address[8] memory tok, uint256[8] memory px)
        internal
        pure
        returns (string memory out)
    {
        out = '    { "prices": [';
        for (uint256 i; i < 8; ++i) {
            out = string.concat(out, i == 0 ? '"' : ', "', vm.toString(px[i]), '"');
        }
        out = string.concat(out, '], "machines": [');
        for (uint256 m; m < ms.length; ++m) {
            out = string.concat(out, m == 0 ? "" : ", ", _machine(ms[m], floorBps, tok, px));
        }
        out = string.concat(out, "] }");
    }

    function _machine(MachineCfg memory m, uint256 floorBps, address[8] memory tok, uint256[8] memory px)
        internal
        pure
        returns (string memory out)
    {
        Arclaw.OutcomeInput[] memory t = buildTable(m, floorBps, tok, px);
        out = string.concat('{ "id": ', vm.toString(m.id), ', "outcomes": [');
        for (uint256 k; k < t.length; ++k) {
            out = string.concat(out, k == 0 ? "" : ", ", _outcome(t[k]));
        }
        out = string.concat(out, "] }");
    }

    function _outcome(Arclaw.OutcomeInput memory o) internal pure returns (string memory s) {
        s = string.concat('{ "weight": "', vm.toString(uint256(o.weight)), '", "tier": ', vm.toString(uint256(o.tier)), ', "tokens": [');
        for (uint256 c; c < 3; ++c) {
            s = string.concat(s, c == 0 ? "" : ", ", vm.toString(uint256(uint160(o.tokens[c])) - 0x1000));
        }
        s = string.concat(s, '], "amounts": [');
        for (uint256 c; c < 3; ++c) {
            s = string.concat(s, c == 0 ? '"' : ', "', vm.toString(o.amounts[c]), '"');
        }
        s = string.concat(s, "] }");
    }
}
