// SPDX-License-Identifier: MIT
// TemporalAttestationBridge.sol — Substrate 627 Bridge
// Maps FCC file attestations to immutable blockchain records
// Network: Ethereum-compatible (Polygon, Arbitrum, or L2)
// Author: ORCID 0009-0005-2697-4668
// Date: 2026-05-24

pragma solidity ^0.8.19;

contract TemporalAttestationBridge {
    // ── Events ─────────────────────────────────────────────────────────
    event AttestationRegistered(
        bytes32 indexed fileHash,
        string filename,
        uint256 timestamp,
        address indexed submitter,
        string ipnsCid,
        uint256 doacoesCount,
        uint256 valorTotalCentavos
    );

    event AnomalyDetected(
        bytes32 indexed fileHash,
        string reason,
        uint256 timestamp
    );

    // ── State ──────────────────────────────────────────────────────────
    struct Attestation {
        bytes32 fileHash;      // SHA3-256 of raw .FCC bytes
        string filename;
        uint256 timestamp;
        address submitter;
        string ipnsCid;        // IPNS pointer to full audit trail
        uint256 doacoesCount;
        uint256 valorTotalCentavos;
        bool valid;
    }

    mapping(bytes32 => Attestation) public attestations;
    mapping(bytes32 => bool) public knownHashes;
    bytes32[] public attestationList;

    address public governance;
    uint256 public constant MIN_STAKE = 0.01 ether;

    // ── Modifiers ──────────────────────────────────────────────────────
    modifier onlyGovernance() {
        require(msg.sender == governance, "627: not governance");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────
    constructor() {
        governance = msg.sender;
    }

    // ── Core Functions ─────────────────────────────────────────────────

    /**
     * @notice Register an FCC file attestation after off-chain validation
     * @param fileHash SHA3-256 of the .FCC file
     * @param filename Original filename (e.g., ATSEFCC00120200131000001.FCC)
     * @param ipnsCid IPNS key pointing to full audit trail (Substrate 547)
     * @param doacoesCount Number of DETALHE 1 records
     * @param valorTotalCentavos Sum of all donation values in centavos
     */
    function registerAttestation(
        bytes32 fileHash,
        string calldata filename,
        string calldata ipnsCid,
        uint256 doacoesCount,
        uint256 valorTotalCentavos
    ) external payable {
        require(msg.value >= MIN_STAKE, "627: insufficient stake");
        require(!knownHashes[fileHash], "627: file already attested");
        require(bytes(filename).length > 0, "627: empty filename");
        require(bytes(ipnsCid).length > 0, "627: empty IPNS");

        Attestation memory a = Attestation({
            fileHash: fileHash,
            filename: filename,
            timestamp: block.timestamp,
            submitter: msg.sender,
            ipnsCid: ipnsCid,
            doacoesCount: doacoesCount,
            valorTotalCentavos: valorTotalCentavos,
            valid: true
        });

        attestations[fileHash] = a;
        knownHashes[fileHash] = true;
        attestationList.push(fileHash);

        emit AttestationRegistered(
            fileHash,
            filename,
            block.timestamp,
            msg.sender,
            ipnsCid,
            doacoesCount,
            valorTotalCentavos
        );
    }

    /**
     * @notice Flag an attestation as anomalous (e.g., mass fraud detected)
     * Callable by governance or AetherWeave slashing consensus (Substrate 561)
     */
    function flagAnomaly(bytes32 fileHash, string calldata reason) external onlyGovernance {
        require(knownHashes[fileHash], "627: unknown file");
        attestations[fileHash].valid = false;
        emit AnomalyDetected(fileHash, reason, block.timestamp);
    }

    /**
     * @notice Retrieve attestation by hash
     */
    function getAttestation(bytes32 fileHash)
        external
        view
        returns (Attestation memory)
    {
        require(knownHashes[fileHash], "627: unknown file");
        return attestations[fileHash];
    }

    /**
     * @notice Batch query for transparency dashboards
     */
    function getAttestationRange(uint256 start, uint256 end)
        external
        view
        returns (Attestation[] memory)
    {
        require(start < end && end <= attestationList.length, "627: invalid range");
        Attestation[] memory batch = new Attestation[](end - start);
        for (uint256 i = start; i < end; i++) {
            batch[i - start] = attestations[attestationList[i]];
        }
        return batch;
    }

    /**
     * @notice Update governance address (2/3 supermajority via Tokenic 624)
     */
    function updateGovernance(address newGov) external onlyGovernance {
        governance = newGov;
    }

    // ── Fallback ───────────────────────────────────────────────────────
    receive() external payable {
        revert("627: direct deposits not allowed");
    }
}