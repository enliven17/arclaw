// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockAstockDesk} from "../src/mocks/MockAstockDesk.sol";
import {MockPriceSource} from "../src/mocks/MockPriceSource.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";

contract MockDeskTest is Test {
    MockPriceSource prices;
    MockAstockDesk desk;
    MockStock nvda;
    address alice = makeAddr("alice");

    function setUp() public {
        prices = new MockPriceSource();
        nvda = new MockStock("NVDA.arc");
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        t[0] = address(nvda);
        p[0] = 200e6; // $200, 6 dp
        prices.setPrices(t, p);
        desk = new MockAstockDesk(IPriceSource(address(prices)));
        nvda.setMinter(address(desk), true);
        vm.deal(address(desk), 1_000 ether);
        nvda.mint(alice, 2 ether); // 2 shares
    }

    function test_quoteSell_paysPriceMinusSpread() public view {
        (uint256 out, bool ok) = desk.quoteSell(address(nvda), 1 ether);
        assertTrue(ok);
        assertEq(out, 200 ether * 9_950 / 10_000);
    }

    function test_sell_paysNativeUsdcAndTakesShares() public {
        vm.startPrank(alice);
        nvda.approve(address(desk), 1 ether);
        (uint256 quote,) = desk.quoteSell(address(nvda), 1 ether);
        uint256 before = alice.balance;
        desk.sell(address(nvda), 1 ether, quote, alice);
        vm.stopPrank();
        assertEq(alice.balance - before, quote);
        assertEq(nvda.balanceOf(alice), 1 ether);
        assertEq(nvda.balanceOf(address(desk)), 1 ether);
    }

    function test_sell_revertsBelowMinOut() public {
        vm.startPrank(alice);
        nvda.approve(address(desk), 1 ether);
        (uint256 quote,) = desk.quoteSell(address(nvda), 1 ether);
        vm.expectRevert(MockAstockDesk.Slippage.selector);
        desk.sell(address(nvda), 1 ether, quote + 1, alice);
        vm.stopPrank();
    }

    function test_sell_revertsWithoutApproval() public {
        vm.prank(alice);
        vm.expectRevert();
        desk.sell(address(nvda), 1 ether, 0, alice);
    }

    function test_sell_revertsWhenDeskIsShort() public {
        vm.deal(address(desk), 1 ether);
        vm.startPrank(alice);
        nvda.approve(address(desk), 1 ether);
        (, bool ok) = desk.quoteSell(address(nvda), 1 ether);
        assertFalse(ok);
        vm.expectRevert(MockAstockDesk.InsufficientLiquidity.selector);
        desk.sell(address(nvda), 1 ether, 0, alice);
        vm.stopPrank();
    }

    function test_sell_revertsOnZero() public {
        vm.prank(alice);
        vm.expectRevert(MockAstockDesk.ZeroAmount.selector);
        desk.sell(address(nvda), 0, 0, alice);
    }

    function testFuzz_sellRoundTrip(uint96 shares) public {
        shares = uint96(bound(shares, 1e9, 2 ether));
        vm.startPrank(alice);
        nvda.approve(address(desk), shares);
        (uint256 quote, bool ok) = desk.quoteSell(address(nvda), shares);
        vm.assume(ok);
        uint256 before = alice.balance;
        desk.sell(address(nvda), shares, quote, alice);
        vm.stopPrank();
        assertEq(alice.balance - before, quote);
        // Never pays more than the shares are worth at the price.
        assertLe(quote, uint256(shares) * 200);
    }
}
