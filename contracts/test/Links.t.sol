// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {ArclawLinks} from "../src/ArclawLinks.sol";

contract LinksTest is Base {
    uint256 linkPk = 0xA11CE;
    address linkKey;

    function setUp() public override {
        super.setUp();
        linkKey = vm.addr(linkPk);
        _play(alice, M2, 5);
    }

    function _create(uint32 n, uint256 ttl) internal returns (uint256 id) {
        id = _link(alice, linkKey, M2, n, block.timestamp + ttl);
    }

    function _sign(uint256 pk, uint256 linkId, address recipient) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, links.claimDigest(linkId, recipient));
        return abi.encodePacked(r, s, v);
    }

    function test_claimLink_happyPath() public {
        uint256 id = _create(3, 1 days);
        assertEq(box.balanceOf(alice, M2), 2);
        assertEq(box.balanceOf(address(links), M2), 3);
        assertEq(links.escrowed(M2), 3);
        (address sender, uint32 boxes, uint16 m,, ArclawLinks.LinkStatus st, address key) = links.links(id);
        assertEq(sender, alice);
        assertEq(boxes, 3);
        assertEq(m, M2);
        assertEq(uint8(st), uint8(ArclawLinks.LinkStatus.Open));
        assertEq(key, linkKey);

        bytes memory sig = _sign(linkPk, id, bob);
        vm.prank(makeAddr("relayer")); // anyone may relay
        links.claimLink(id, bob, sig);
        assertEq(box.balanceOf(bob, M2), 3);
        assertEq(links.escrowed(M2), 0);
        assertEq(box.balanceOf(address(links), M2), 0);
    }

    function test_createLink_byApprovedOperatorCreditsTheOwner() public {
        address agent = makeAddr("agent");
        vm.prank(alice);
        box.setApprovalForAll(agent, true);
        vm.prank(agent);
        box.safeTransferFrom(alice, address(links), M2, 2, abi.encode(linkKey, block.timestamp + 1 hours));
        (address sender,,,,,) = links.links(0);
        assertEq(sender, alice, "the box owner, not the operator, can reclaim");
    }

    function test_claimLink_digestMatchesEip712() public view {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("arclaw"),
                keccak256("1"),
                block.chainid,
                address(links)
            )
        );
        bytes32 structHash = keccak256(abi.encode(keccak256("Claim(uint256 linkId,address recipient)"), 7, bob));
        assertEq(links.claimDigest(7, bob), keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
    }

    function test_claimLink_wrongSigner() public {
        uint256 id = _create(1, 1 days);
        bytes memory sig = _sign(0xBAD, id, bob);
        vm.expectRevert(ArclawLinks.BadSignature.selector);
        links.claimLink(id, bob, sig);
    }

    function test_claimLink_frontRunCannotRedirect() public {
        uint256 id = _create(1, 1 days);
        bytes memory sig = _sign(linkPk, id, bob);
        address mallory = makeAddr("mallory");
        vm.prank(mallory);
        vm.expectRevert(ArclawLinks.BadSignature.selector);
        links.claimLink(id, mallory, sig); // copied from the mempool, different recipient
    }

    function test_claimLink_replay() public {
        uint256 id = _create(1, 1 days);
        bytes memory sig = _sign(linkPk, id, bob);
        links.claimLink(id, bob, sig);
        vm.expectRevert(ArclawLinks.LinkNotOpen.selector);
        links.claimLink(id, bob, sig);
    }

    function test_claimLink_signatureBoundToLinkId() public {
        uint256 id0 = _create(1, 1 days);
        bytes memory sig = _sign(linkPk, id0, bob);
        uint256 id1 = _link(alice, vm.addr(0xB0B), M2, 1, block.timestamp + 1 days);
        vm.expectRevert(ArclawLinks.BadSignature.selector);
        links.claimLink(id1, bob, sig);
    }

    function test_linkKeyReuseRejected() public {
        _create(1, 1 days);
        vm.prank(alice);
        vm.expectRevert(ArclawLinks.LinkKeyUsed.selector);
        box.safeTransferFrom(alice, address(links), M2, 1, abi.encode(linkKey, block.timestamp + 1 days));
    }

    function test_reclaimAfterExpiry() public {
        uint256 t0 = block.timestamp;
        uint256 id = _create(2, 1 hours);
        vm.prank(alice);
        vm.expectRevert(ArclawLinks.LinkNotExpired.selector);
        links.reclaimLink(id);

        vm.warp(t0 + 1 hours + 1);
        bytes memory sig = _sign(linkPk, id, bob);
        vm.expectRevert(ArclawLinks.LinkExpired.selector);
        links.claimLink(id, bob, sig);

        vm.prank(bob);
        vm.expectRevert(ArclawLinks.NotSender.selector);
        links.reclaimLink(id);

        vm.prank(alice);
        links.reclaimLink(id);
        assertEq(box.balanceOf(alice, M2), 5);
        assertEq(links.escrowed(M2), 0);

        vm.prank(alice);
        vm.expectRevert(ArclawLinks.LinkNotOpen.selector);
        links.reclaimLink(id);
    }

    function test_createLink_validation() public {
        vm.startPrank(alice);
        vm.expectRevert(ArclawLinks.BadLink.selector);
        box.safeTransferFrom(alice, address(links), M2, 1, abi.encode(address(0), block.timestamp + 1));
        vm.expectRevert(ArclawLinks.BadLink.selector);
        box.safeTransferFrom(alice, address(links), M2, 0, abi.encode(linkKey, block.timestamp + 1));
        vm.expectRevert(ArclawLinks.BadLink.selector);
        box.safeTransferFrom(alice, address(links), M2, 1, abi.encode(linkKey, block.timestamp));
        vm.expectRevert(ArclawLinks.BadLink.selector); // a plain transfer with no link data
        box.safeTransferFrom(alice, address(links), M2, 1, "");
        vm.expectRevert(); // more boxes than held
        box.safeTransferFrom(alice, address(links), M2, 6, abi.encode(linkKey, block.timestamp + 1));
        vm.expectRevert(); // no $1 boxes
        box.safeTransferFrom(alice, address(links), M1, 1, abi.encode(linkKey, block.timestamp + 1));
        uint256[] memory ids = new uint256[](2);
        uint256[] memory vals = new uint256[](2);
        (ids[0], vals[0], ids[1], vals[1]) = (M2, 1, M2, 1);
        vm.expectRevert(ArclawLinks.BadLink.selector); // multi-id batches refused (OZ routes a 1-id batch as single)
        box.safeBatchTransferFrom(alice, address(links), ids, vals, abi.encode(linkKey, block.timestamp + 1));
        vm.stopPrank();
    }

    function test_onlyArclawCanCreate() public {
        vm.expectRevert(ArclawLinks.NotArclaw.selector);
        links.onERC1155Received(address(this), alice, M2, 1, abi.encode(linkKey, block.timestamp + 1));
    }
}
