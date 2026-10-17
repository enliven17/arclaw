// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockAstockDesk} from "../src/mocks/MockAstockDesk.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";

/// Testnet only: a MockAstockDesk with sell/quoteSell on the existing price source, funded so it can buy shares back,
/// and a minter on every mock stock (the deployer owns them). Arclaw is not touched. Run after the contract change has
/// passed its audits (CLAUDE.md), then put the printed address in lib/deployments/arc-testnet.json as "sellDesk":
///   forge script script/DeployDesk.s.sol --tc DeployDesk --rpc-url https://rpc.testnet.arc.io --private-key $PRIVATE_KEY \
///     --broadcast --with-gas-price 25gwei
contract DeployDesk is Script {
    uint256 constant TESTNET = 5042002;
    /// Native USDC (18 dp) the desk starts with to pay sellers.
    uint256 constant FUNDING = 20 ether;

    function run() external returns (address desk) {
        require(block.chainid == TESTNET, "testnet only");
        string memory json = vm.readFile("../lib/deployments/arc-testnet.json");
        address priceSource = vm.parseJsonAddress(json, ".priceSource");
        string[] memory keys = vm.parseJsonKeys(json, ".stocks");

        vm.startBroadcast();
        MockAstockDesk d = new MockAstockDesk(IPriceSource(priceSource));
        desk = address(d);
        for (uint256 i; i < keys.length; ++i) {
            address stock = vm.parseJsonAddress(json, string.concat(".stocks.", keys[i]));
            MockStock(stock).setMinter(desk, true);
        }
        (bool ok,) = desk.call{value: FUNDING}("");
        require(ok, "funding failed");
        vm.stopBroadcast();

        console.log("sellDesk", desk);
    }
}
