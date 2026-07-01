// SPDX-License-Identifier: ARKHE-CATHEDRAL
pragma solidity ^0.8.20;

/// @title Glosa245Anchor
/// @notice Ancora a sequência canônica B(2,5) e seu selo SHA‑256 na blockchain.
contract Glosa245Anchor {
    address public immutable architect;
    bytes32 public canonicalSequenceHash;
    uint256 public deploymentBlock;

    event SequenceAnchored(bytes32 indexed hash, string sequence);
    event VerificationAttempt(bytes32 indexed providedHash, bool valid);

    modifier onlyArchitect() {
        require(msg.sender == architect, "Apenas o Arquiteto pode ancorar");
        _;
    }

    constructor() {
        architect = msg.sender;
        deploymentBlock = block.number;
    }

    /// @notice Ancora a sequência pela primeira (e única) vez.
    /// @param sequence A string binária de 36 bits (ex.: "110000010010100011001111101101011100")
    /// @param expectedHash O SHA‑256 da sequência (como verificação off‑chain).
    function anchorSequence(string calldata sequence, bytes32 expectedHash) external onlyArchitect {
        require(canonicalSequenceHash == bytes32(0), "Sequência já ancorada");
        bytes32 hash = keccak256(abi.encodePacked(sequence));
        require(hash == expectedHash, "Hash não confere");
        canonicalSequenceHash = hash;
        emit SequenceAnchored(hash, sequence);
    }

    /// @notice Verifica se um hash corresponde à sequência canônica.
    /// @param providedHash O hash a ser testado.
    /// @return valid True se o hash coincide com o armazenado.
    function verifyHash(bytes32 providedHash) external view returns (bool valid) {
        valid = (canonicalSequenceHash != bytes32(0) && providedHash == canonicalSequenceHash);
    }
}