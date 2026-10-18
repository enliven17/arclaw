// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {Arclaw} from "../../src/Arclaw.sol";
import {LuckVault, ILuck} from "../../src/LuckVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Vm.sol";

/// Stand-in for Arc's USDC ERC-20 view at 0x3600..00: 6 dp, backed by the account's native (18 dp) balance, so a
/// transfer moves native USDC. Uses the cheatcode address only to emulate the precompile.
contract ArcUsdcAlias {
    Vm constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function balanceOf(address a) external view returns (uint256) {
        return a.balance / 1e12;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 wei_ = amount * 1e12;
        VM.deal(msg.sender, msg.sender.balance - wei_);
        VM.deal(to, to.balance + wei_);
        return true;
    }
}

/// A token whose calls succeed with no return data (a proxy upgraded/pointed at the wrong implementation).
contract SilentToken {
    fallback() external {}
}

contract A3bArclawToken is ERC20 {
    constructor() ERC20("ARCLAW", "ARCLAW") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

/// A contract that holds one aged stake and opens anybody's boxes with it, forwarding the cards.
contract BoostRenter {
    Arclaw immutable box;

    constructor(Arclaw b) {
        box = b;
    }

    function stake(LuckVault v, IERC20 t, uint256 a) external {
        t.approve(address(v), a);
        v.stake(a);
    }

    function openFor(uint256 machineId, uint256 n) external returns (uint256 id) {
        (id,) = box.open(machineId, n);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    receive() external payable {}
}

/// Auditor 3b. Each test documents CURRENT (vulnerable) behaviour; flip the assertions when fixed.
contract A3bFindingsTest is Base {
    address constant USDC_ERC20 = 0x3600000000000000000000000000000000000000;

    function setUp() public override {
        super.setUp();
        box.setPrizes(M1, _table(address(nvda), P1)); // 0.5x (w3) / 1.5x (w1): EV 0.75x at $200
    }

    function _setNvda(uint256 px) internal {
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        (t[0], p[0]) = (address(nvda), px);
        prices.setPrices(t, p);
    }

    /// EV of the current M1 table at live prices, bps of the price.
    function _liveRtpBps() internal view returns (uint256) {
        Arclaw.Outcome[] memory o = box.outcomes(M1);
        uint256 ev;
        uint256 w;
        for (uint256 i; i < o.length; ++i) {
            uint256 v;
            for (uint256 c; c < 3; ++c) {
                v += box.valueOf(o[i].cards[c].token, o[i].cards[c].amount);
            }
            ev += v * o[i].weight;
            w += o[i].weight;
        }
        return ev * 10_000 / w / P1;
    }

    // ------------------------------------------------------------------ M-01 (3b)

    /// M-01: sweep(token) has no exclusion for Arc's USDC ERC-20 view (0x3600..00). On Arc that token IS the native
    /// balance, so the owner (or a stolen owner key) moves native USDC out with sweep while withdraw() is blocked by
    /// _requireFree: owed credit and pending openings end up unbacked.
    function test_m01_sweepUsdcAliasBypassesReserve() public {
        vm.etch(USDC_ERC20, address(new ArcUsdcAlias()).code);
        vm.deal(address(box), 0);
        _play(alice, M1, 4);
        _open(alice, M1, 4);
        vm.deal(address(box), 4 ether); // exactly backed, no float
        assertEq(box.pendingReserve(), 4 ether);
        assertEq(box.freeBalance(), 0);

        vm.expectRevert(abi.encodeWithSelector(Arclaw.Reserved.selector, 0));
        box.withdraw(address(this), 1);

        box.sweep(USDC_ERC20, address(0xBEEF), 4e6); // 4 USDC through the ERC-20 view
        assertEq(address(box).balance, 0, "all native gone");
        assertEq(address(0xBEEF).balance, 4 ether);
        assertEq(box.pendingReserve(), 4 ether, "liability still recorded, nothing backs it");
    }

    // ------------------------------------------------------------------ M-02 (3b)

    /// M-02: card amounts are fixed in shares at table time and open() only checks the table's age (1 day,
    /// owner-unbounded), never live prices. A holder of sealed boxes opens only when the table's stocks have risen
    /// since pricing: +40% on NVDA turns the 75% table into 105% expected return (plus luck), a free option on
    /// the house. The opposite move breaks the product floor: -50% leaves the common pack at 25% of the price.
    function test_m02_staleTableIsAFreeOptionForHolders() public {
        _play(alice, M1, 20);
        vm.warp(block.timestamp + 20 hours); // table still "fresh"
        _setNvda(280e6); // +40% since the table was priced
        assertGt(_liveRtpBps(), 10_000, "live EV above the price");
        (uint256 id,) = _open(alice, M1, 20); // accepted
        assertEq(uint8(_status(id)), uint8(Arclaw.OpeningStatus.Pending));

        // the window is owner-tunable without an upper bound
        box.setMaxTableAge(365 days);
        assertEq(box.maxTableAge(), 365 days);

        // the other direction: the 50% floor holds only at pricing time
        _setNvda(100e6);
        Arclaw.Outcome[] memory o = box.outcomes(M1);
        uint256 v;
        for (uint256 c; c < 3; ++c) {
            v += box.valueOf(o[0].cards[c].token, o[0].cards[c].amount);
        }
        assertLt(v * 10_000 / P1, 5000, "common pack now worth 25% of the price");
        _play(bob, M1, 1);
        _open(bob, M1, 1); // still accepted
    }

    // ------------------------------------------------------------------ L-01 (3b)

    /// L-01: _balanceOf wraps balanceOf in try/catch, but a card token that answers with empty/short data makes the
    /// ABI decode revert in the caller, which try/catch does not catch. A fulfilled opening then can never be
    /// revealed, and there is no exit: returnBoxes and retry both revert (NotPending; AlreadyFulfilled if the callback had failed). The paid boxes and
    /// their pendingReserve are stuck forever (same root cause as 3a L-03, but here it is permanent per opening).
    function test_l01_cardTokenDecodeFailureStrandsFulfilledOpening() public {
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));
        vm.etch(address(nvda), address(new SilentToken()).code); // token proxy now returns nothing

        vm.expectRevert();
        box.reveal(id);

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotPending.selector);
        box.returnBoxes(id);
        vm.prank(alice);
        vm.expectRevert(Arclaw.NotPending.selector);
        box.retry(id);
        assertEq(box.pendingReserve(), 1 ether, "reserve locked for good");
    }

    // ------------------------------------------------------------------ L-02 (3b)

    /// L-02: when the price source reverts (Astock isStale, unpriced), a short card is refunded at its table-time
    /// value instead of min(table, current). After a crash followed by a stale feed, the house pays the old price:
    /// here 0.75 USDC for cards last priced at 0.375.
    function test_l02_staleOracleRefundsAtTableTimeValue() public {
        _forceSingle(M1, address(nvda), 0.75 ether);
        box.sweep(address(nvda), address(1), 100 ether); // short: every card is refunded (JIT off)
        _play(alice, M1, 1);
        (uint256 id, uint256 req) = _open(alice, M1, 1);
        vrf.fulfill(req, keccak256("w"));

        _setNvda(100e6); // -50%: a fair refund is now 0.375
        _setNvda(0); // feed goes stale / unpriced: priceOf reverts
        uint256 before = alice.balance;
        box.reveal(id);
        assertApproxEqAbs(alice.balance - before, 0.75 ether, 10, "refund at the pre-crash table value");
    }

    // ------------------------------------------------------------------ INFO (3b)

    /// INFO: the boost belongs to whoever calls open(), and boxes are freely transferable. One aged stake behind a
    /// contract can open everyone's boxes at the maximum boost (boost renting). RTP stays inside the band because
    /// the band is checked at MAX_BOOST_BPS, but "locked holders" stops being the population that gets the boost.
    function test_info_boostCanBeRentedThroughAnOpenerContract() public {
        LuckVault v = new LuckVault();
        A3bArclawToken t = new A3bArclawToken();
        v.setLuckToken(address(t));
        uint256[] memory mins = new uint256[](1);
        uint256[] memory bps = new uint256[](1);
        (mins[0], bps[0]) = (1000 ether, 100);
        v.setTiers(mins, bps);
        box.setLuck(ILuck(address(v)));

        BoostRenter renter = new BoostRenter(box);
        t.mint(address(renter), 1000 ether);
        renter.stake(v, IERC20(address(t)), 1000 ether);
        vm.warp(block.timestamp + 25 hours);
        box.setPrizes(M1, _table(address(nvda), P1)); // reprice after the warp

        _play(bob, M1, 1); // bob has no stake
        vm.prank(bob);
        box.safeTransferFrom(bob, address(renter), M1, 1, "");
        uint256 id = renter.openFor(M1, 1);
        assertEq(box.openingBoost(id), 100, "bob's box opened at max boost");
    }
}
