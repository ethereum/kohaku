// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title OctraFHERC721
 * @dev Confidential ERC721 for Octra HFHE ↔ Fhenix CoFHE
 * Substrate 840+ — Confidential NFT Module
 */
contract OctraFHERC721 is ERC721 {
    // Mapping: Token ID → encrypted URI/metadata handle
    mapping(uint256 => euint64) public tokenEncryptedMetadata;

    // Mapping: Octra Circle ID → token IDs in this circle
    mapping(string => uint256[]) public circleBridgeTokens;

    // Mapping: Token ID → owner Circle ID
    mapping(uint256 => string) public tokenCircleOwner;

    event TokenBridged(string circleId, uint256 tokenId, uint256 metadataHandle);
    event TokenUnshielded(string circleId, uint256 tokenId, address owner, bytes thresholdSignature);

    constructor() ERC721("Octra Confidential NFT", "OCTRA-NFT") {}

    /**
     * @dev Bridge public NFT to confidential NFT (shield)
     */
    function shieldFromOctra(
        string calldata circleId,
        uint256 tokenId,
        InEuint64 memory encryptedMetadata
    ) external {
        // Mint the confidential NFT representation to the user
        _safeMint(msg.sender, tokenId);

        euint64 encMetadata = FHE.asEuint64(encryptedMetadata);
        tokenEncryptedMetadata[tokenId] = encMetadata;

        circleBridgeTokens[circleId].push(tokenId);
        tokenCircleOwner[tokenId] = circleId;

        uint256 handle = FHE.getHandle(encMetadata);
        FHE.allowThis(handle);

        emit TokenBridged(circleId, tokenId, handle);
    }

    /**
     * @dev Unshield confidential NFT back to public
     */
    function unshieldToOctra(
        string calldata circleId,
        uint256 tokenId,
        uint64 plaintextMetadata,
        bytes calldata thresholdSignature
    ) external {
        require(ownerOf(tokenId) == msg.sender, "Not token owner");
        require(keccak256(bytes(tokenCircleOwner[tokenId])) == keccak256(bytes(circleId)), "Not token owner circle");

        euint64 encMetadata = tokenEncryptedMetadata[tokenId];
        uint256 handle = FHE.getHandle(encMetadata);

        // Verify threshold signature
        FHE.verifyDecryptResult(handle, plaintextMetadata, thresholdSignature);

        // Remove from circle
        _removeTokenFromCircle(circleId, tokenId);
        delete tokenCircleOwner[tokenId];

        // Burn the confidential NFT
        _burn(tokenId);

        emit TokenUnshielded(circleId, tokenId, msg.sender, thresholdSignature);
    }

    /**
     * @dev Helper to remove a token ID from an array in storage
     */
    function _removeTokenFromCircle(string calldata circleId, uint256 tokenId) internal {
        uint256[] storage tokens = circleBridgeTokens[circleId];
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == tokenId) {
                tokens[i] = tokens[tokens.length - 1];
                tokens.pop();
                break;
            }
        }
    }
}
