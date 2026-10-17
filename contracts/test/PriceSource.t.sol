// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AstockPriceSource} from "../src/AstockPriceSource.sol";
import {IAstockOracle} from "../src/interfaces/IAstock.sol";

contract FakeOracle is IAstockOracle {
    uint256 public price = 200e6;
    bool public stale;

    function set(uint256 p, bool s) external {
        (price, stale) = (p, s);
    }

    function getPrice(address) external view returns (uint256) {
        return price;
    }

    function isStale(address) external view returns (bool) {
        return stale;
    }
}

contract AstockPriceSourceTest is Test {
    FakeOracle oracle;
    AstockPriceSource src;
    address token = makeAddr("NVDA.arc");
    address under = makeAddr("NVDA");

    function setUp() public {
        oracle = new FakeOracle();
        src = new AstockPriceSource(oracle);
        address[] memory t = new address[](1);
        address[] memory u = new address[](1);
        (t[0], u[0]) = (token, under);
        src.setUnderlyings(t, u);
    }

    function test_priceOf() public view {
        assertEq(src.priceOf(token), 200e6);
    }

    function test_staleReverts() public {
        oracle.set(200e6, true);
        vm.expectRevert(abi.encodeWithSelector(AstockPriceSource.Stale.selector, token));
        src.priceOf(token);
    }

    function test_unmappedAndZeroRevert() public {
        vm.expectRevert(abi.encodeWithSelector(AstockPriceSource.Unmapped.selector, address(1)));
        src.priceOf(address(1));
        oracle.set(0, false);
        vm.expectRevert(abi.encodeWithSelector(AstockPriceSource.Unpriced.selector, token));
        src.priceOf(token);
    }

    function test_onlyOwnerMaps() public {
        address[] memory t = new address[](0);
        vm.prank(makeAddr("x"));
        vm.expectRevert();
        src.setUnderlyings(t, t);
    }
}
