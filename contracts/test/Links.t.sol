// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {Arclaw} from "../src/Arclaw.sol";

contract LinksTest is Base {
    uint256 linkPk = 0xA11CE;
    address linkKey;

    function setUp() public override {
        super.setUp();
        linkKey = vm.addr(linkPk);
        _play(alice, 5);
    }

    function _create(uint32 n, uint64 ttl) internal returns (uint256 id) {
        vm.prank(alice);
        id = box.createLink(linkKey, n, uint64(block.timestamp) + ttl);
    }

    function _sign(uint256 pk, uint256 linkId, address recipient) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, box.claimDigest(linkId, recipient));
        return abi.encodePacked(r, s, v);
    }

    function test_claimLink_happyPath() public {
        uint256 id = _create(3, 1 days);
        assertEq(box.balanceOf(alice, 0), 2);
        assertEq(box.balanceOf(address(box), 0), 3);
        assertEq(box.escrowedBoxes(), 3);

        bytes memory sig = _sign(linkPk, id, bob);
        vm.prank(makeAddr("relayer")); // anyone may relay
        box.claimLink(id, bob, sig);
        assertEq(box.balanceOf(bob, 0), 3);
        assertEq(box.escrowedBoxes(), 0);
        assertEq(box.balanceOf(address(box), 0), 0);
    }

    function test_claimLink_digestMatchesEip712() public view {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("arclaw"),
                keccak256("1"),
                block.chainid,
                address(box)
            )
        );
        bytes32 structHash = keccak256(abi.encode(keccak256("Claim(uint256 linkId,address recipient)"), 7, bob));
        assertEq(box.claimDigest(7, bob), keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
    }

    function test_claimLink_wrongSigner() public {
        uint256 id = _create(1, 1 days);
        bytes memory sig = _sign(0xBAD, id, bob);
        vm.expectRevert(Arclaw.BadSignature.selector);
        box.claimLink(id, bob, sig);
    }

    function test_claimLink_frontRunCannotRedirect() public {
        uint256 id = _create(1, 1 days);
        bytes memory sig = _sign(linkPk, id, bob);
        address mallory = makeAddr("mallory");
        vm.prank(mallory);
        vm.expectRevert(Arclaw.BadSignature.selector);
        box.claimLink(id, mallory, sig); // copied from the mempool, different recipient
    }

    function test_claimLink_replay() public {
        uint256 id = _create(1, 1 days);
        bytes memory sig = _sign(linkPk, id, bob);
        box.claimLink(id, bob, sig);
        vm.expectRevert(Arclaw.LinkNotOpen.selector);
        box.claimLink(id, bob, sig);
    }

    function test_claimLink_signatureBoundToLinkId() public {
        uint256 id0 = _create(1, 1 days);
        bytes memory sig = _sign(linkPk, id0, bob);
        uint256 otherPk = 0xB0B;
        vm.prank(alice);
        uint256 id1 = box.createLink(vm.addr(otherPk), 1, uint64(block.timestamp + 1 days));
        vm.expectRevert(Arclaw.BadSignature.selector);
        box.claimLink(id1, bob, sig);
    }

    function test_linkKeyReuseRejected() public {
        _create(1, 1 days);
        vm.prank(alice);
        vm.expectRevert(Arclaw.LinkKeyUsed.selector);
        box.createLink(linkKey, 1, uint64(block.timestamp + 1 days));
    }

    function test_reclaimAfterExpiry() public {
        uint256 id = _create(2, 1 hours);
        vm.prank(alice);
        vm.expectRevert(Arclaw.LinkNotExpired.selector);
        box.reclaimLink(id);

        vm.warp(block.timestamp + 1 hours + 1);
        bytes memory sig = _sign(linkPk, id, bob);
        vm.expectRevert(Arclaw.LinkExpired.selector);
        box.claimLink(id, bob, sig);

        vm.prank(bob);
        vm.expectRevert(Arclaw.NotSender.selector);
        box.reclaimLink(id);

        vm.prank(alice);
        box.reclaimLink(id);
        assertEq(box.balanceOf(alice, 0), 5);
        assertEq(box.escrowedBoxes(), 0);

        vm.prank(alice);
        vm.expectRevert(Arclaw.LinkNotOpen.selector);
        box.reclaimLink(id);
    }

    function test_createLink_validation() public {
        vm.startPrank(alice);
        vm.expectRevert(Arclaw.BadLink.selector);
        box.createLink(address(0), 1, uint64(block.timestamp + 1));
        vm.expectRevert(Arclaw.BadLink.selector);
        box.createLink(linkKey, 0, uint64(block.timestamp + 1));
        vm.expectRevert(Arclaw.BadLink.selector);
        box.createLink(linkKey, 1, uint64(block.timestamp));
        vm.expectRevert(); // insufficient balance
        box.createLink(linkKey, 6, uint64(block.timestamp + 1));
        vm.stopPrank();
    }

}
