// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArclawLinks: gift links for Arclaw boxes
/// @notice Escrows sealed boxes under an ephemeral public key. The sender creates a link in ONE transaction, with no
///         approval, by transferring boxes here with the link parameters as data:
///             arclaw.safeTransferFrom(sender, links, machineId, boxes, abi.encode(linkKey, expiresAt))
///         The recipient claims with the link key's EIP-712 signature over Claim(linkId, recipient), so the secret
///         never has to hit the mempool and a front-runner can only deliver the boxes to the signed recipient.
///         After expiry the sender reclaims what was not claimed.
///         Frontends: share the link only after the creating transfer is confirmed (a front-run reusing the
///         pending linkKey makes the honest transfer revert with LinkKeyUsed).
contract ArclawLinks is IERC1155Receiver, EIP712, ReentrancyGuard {
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(uint256 linkId,address recipient)");

    enum LinkStatus {
        None,
        Open,
        Claimed,
        Reclaimed
    }

    struct Link {
        address sender;
        uint32 boxes;
        uint16 machineId;
        uint40 expiresAt;
        LinkStatus status;
        address linkKey;
    }

    IERC1155 public immutable arclaw;

    mapping(uint256 => Link) public links;
    mapping(address => bool) public linkKeyUsed;
    uint256 public nextLinkId;
    /// machineId => boxes held for open links (== arclaw.balanceOf(this, machineId))
    mapping(uint256 => uint256) public escrowed;

    event LinkCreated(
        uint256 indexed linkId,
        address indexed sender,
        address indexed linkKey,
        uint256 machineId,
        uint256 boxes,
        uint256 expiresAt
    );
    event LinkClaimed(uint256 indexed linkId, address indexed sender, address indexed recipient, uint256 boxes);
    event LinkReclaimed(uint256 indexed linkId, address indexed sender, uint256 boxes);

    error NotArclaw();
    error BadLink();
    error LinkKeyUsed();
    error LinkNotOpen();
    error LinkExpired();
    error LinkNotExpired();
    error BadSignature();
    error NotSender();

    constructor(IERC1155 arclaw_) EIP712("arclaw", "1") {
        arclaw = arclaw_;
    }

    // ------------------------------------------------------------------ create (ERC-1155 receive hook)

    /// @dev `from` is the box owner (the sender), whoever operated the transfer. Data: (address linkKey, uint40 expiresAt).
    function onERC1155Received(address, address from, uint256 id, uint256 value, bytes calldata data)
        external
        returns (bytes4)
    {
        if (msg.sender != address(arclaw)) revert NotArclaw();
        if (data.length != 64) revert BadLink();
        (address linkKey, uint256 expiresAt) = abi.decode(data, (address, uint256));
        if (
            linkKey == address(0) || value == 0 || value > type(uint32).max || id > type(uint16).max
                || expiresAt <= block.timestamp || expiresAt > type(uint40).max
        ) revert BadLink();
        if (linkKeyUsed[linkKey]) revert LinkKeyUsed();
        linkKeyUsed[linkKey] = true;
        uint256 linkId = nextLinkId++;
        // forge-lint: disable-next-line(unsafe-typecast)
        links[linkId] = Link(from, uint32(value), uint16(id), uint40(expiresAt), LinkStatus.Open, linkKey);
        escrowed[id] += value;
        emit LinkCreated(linkId, from, linkKey, id, value, expiresAt);
        return this.onERC1155Received.selector;
    }

    /// Batch transfers carry one data blob for many ids: refused, links are created one id at a time.
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert BadLink();
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ------------------------------------------------------------------ claim / reclaim

    /// @notice Claim a link for `recipient` with the link key's signature over claimDigest(linkId, recipient).
    ///         Anyone may relay it.
    function claimLink(uint256 linkId, address recipient, bytes calldata signature) external nonReentrant {
        Link storage l = links[linkId];
        if (l.status != LinkStatus.Open) revert LinkNotOpen();
        if (block.timestamp > l.expiresAt) revert LinkExpired();
        if (recipient == address(0)) revert BadLink();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(claimDigest(linkId, recipient), signature);
        if (err != ECDSA.RecoverError.NoError || signer != l.linkKey) revert BadSignature();

        l.status = LinkStatus.Claimed;
        (uint256 id, uint256 boxes) = (l.machineId, l.boxes);
        escrowed[id] -= boxes;
        emit LinkClaimed(linkId, l.sender, recipient, boxes);
        arclaw.safeTransferFrom(address(this), recipient, id, boxes, "");
    }

    /// @notice After expiry the sender takes unclaimed boxes back.
    function reclaimLink(uint256 linkId) external nonReentrant {
        Link storage l = links[linkId];
        if (l.status != LinkStatus.Open) revert LinkNotOpen();
        if (msg.sender != l.sender) revert NotSender();
        if (block.timestamp <= l.expiresAt) revert LinkNotExpired();
        l.status = LinkStatus.Reclaimed;
        (uint256 id, uint256 boxes) = (l.machineId, l.boxes);
        escrowed[id] -= boxes;
        emit LinkReclaimed(linkId, msg.sender, boxes);
        arclaw.safeTransferFrom(address(this), msg.sender, id, boxes, "");
    }

    /// @notice The EIP-712 digest a link key signs (domain: name "arclaw", version "1", chainId, this contract).
    function claimDigest(uint256 linkId, address recipient) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, linkId, recipient)));
    }
}
