// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Arclaw} from "../src/Arclaw.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {MockPriceSource} from "../src/mocks/MockPriceSource.sol";
import {MockAstockDesk} from "../src/mocks/MockAstockDesk.sol";
import {MockVRFCoordinator} from "../src/mocks/MockVRFCoordinator.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {Vm} from "forge-std/Vm.sol";

abstract contract Base is Test {
    Arclaw box;
    MockVRFCoordinator vrf;
    MockPriceSource prices;
    MockAstockDesk desk;
    MockStock nvda;
    MockStock tsla;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address op = makeAddr("operator");
    uint256 constant PRICE = 1 ether; // 1 USDC native, 18 dp
    uint256 constant SUBSIDY = 0.1 ether;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        vrf = new MockVRFCoordinator();
        box = new Arclaw(PRICE, "ipfs://box/{id}", address(vrf), SUBSIDY);
        prices = new MockPriceSource();
        desk = new MockAstockDesk(IPriceSource(address(prices)));
        nvda = new MockStock("NVDA.arc");
        tsla = new MockStock("TSLA.arc");
        nvda.setMinter(address(desk), true);
        tsla.setMinter(address(desk), true);

        address[] memory t = new address[](2);
        uint256[] memory p = new uint256[](2);
        (t[0], t[1], p[0], p[1]) = (address(nvda), address(tsla), 200e6, 400e6); // $200, $400
        prices.setPrices(t, p);

        box.setPolicy(IPriceSource(address(prices)), 7000, 8000, 50 ether);
        box.setOperator(op);
        box.setSink(address(desk), true);

        nvda.mint(address(box), 100 ether);
        tsla.mint(address(box), 100 ether);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _single(address token, uint256 amount) internal pure returns (Arclaw.Prize[] memory t) {
        t = new Arclaw.Prize[](1);
        t[0] = Arclaw.Prize(token, 1, 0, amount);
    }

    /// NVDA $0.25 a card (weight 3) and TSLA $0.25 a card (weight 1): 3 cards = $0.75 per $1 box = 7500 bps.
    function _bandTable() internal view returns (Arclaw.Prize[] memory t) {
        t = new Arclaw.Prize[](2);
        t[0] = Arclaw.Prize(address(nvda), 3, 0, 0.25e18 * 1e6 / 200e6);
        t[1] = Arclaw.Prize(address(tsla), 1, 1, 0.25e18 * 1e6 / 400e6);
    }

    function _play(address who, uint256 n) internal {
        vm.prank(who);
        box.play{value: n * PRICE}(n);
    }

    function _open(address who, uint256 n) internal returns (uint256 openingId, uint256 requestId) {
        vm.prank(who);
        (openingId, requestId) = box.open(n);
    }

    function _status(uint256 id) internal view returns (Arclaw.OpeningStatus s) {
        (,,, s,,,,) = box.openings(id);
    }

    function _countEvents(Vm.Log[] memory logs, bytes32 sig) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(box) && logs[i].topics[0] == sig) ++n;
        }
    }
}
