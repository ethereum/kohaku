// SPDX-License-Identifier: MIT
// UnifiedElectoralAttestationBridge.sol — Substrates 627 + 628
// Maps FCC (BR) and FEC (US) file attestations to immutable blockchain records
// Network: Ethereum-compatible (Polygon, Arbitrum, or L2)
// Author: ORCID 0009-0005-2697-4668
// Date: 2026-05-24

pragma solidity ^0.8.19;

contract UnifiedElectoralAttestationBridge {
    // ── Enums ──────────────────────────────────────────────────────────
    enum Jurisdiction { BR, US, OTHER }

    // ── Events ─────────────────────────────────────────────────────────
    event AttestationRegistered(
        bytes32 indexed fileHash,
        string filename,
        Jurisdiction jurisdiction,
        uint256 timestamp,
        address indexed submitter,
        string ipnsCid,
        uint256 transactionCount,
        uint256 totalValueCentavos
    );

    event CrossJurisdictionMatch(
        bytes32 indexed brHash,
        bytes32 indexed usHash,
        string matchType,
        uint256 timestamp
    );

    event AnomalyDetected(
        bytes32 indexed fileHash,
        Jurisdiction jurisdiction,
        string reason,
        uint256 timestamp
    );

    // ── State ──────────────────────────────────────────────────────────
    struct Attestation {
        bytes32 fileHash;
        string filename;
        Jurisdiction jurisdiction;
        uint256 timestamp;
        address submitter;
        string ipnsCid;
        uint256 transactionCount;
        uint256 totalValueCentavos;  // cents (BR) or cents (US)
        bool valid;
    }

    mapping(bytes32 => Attestation) public attestations;
    mapping(bytes32 => bool) public knownHashes;
    bytes32[] public attestationList;

    // Cross-jurisdiction index: contributor hash -> [file hashes]
    mapping(bytes32 => bytes32[]) public contributorIndex;

    address public governance;
    uint256 public constant MIN_STAKE = 0.01 ether;

    // ── Modifiers ──────────────────────────────────────────────────────
    modifier onlyGovernance() {
        require(msg.sender == governance, "627/628: not governance");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────
    constructor() {
        governance = msg.sender;
    }

    // ── Core Functions ─────────────────────────────────────────────────

    /**
     * @notice Register an electoral file attestation (BR or US)
     * @param fileHash SHA3-256 of the raw file
     * @param filename Original filename
     * @param jurisdiction BR for TSE FCC, US for FEC .fec
     * @param ipnsCid IPNS key to full audit trail
     * @param transactionCount Number of transactions (doações or receipts)
     * @param totalValueCentavos Total value in centavos/cents
     */
    function registerAttestation(
        bytes32 fileHash,
        string calldata filename,
        Jurisdiction jurisdiction,
        string calldata ipnsCid,
        uint256 transactionCount,
        uint256 totalValueCentavos
    ) external payable {
        require(msg.value >= MIN_STAKE, "627/628: insufficient stake");
        require(!knownHashes[fileHash], "627/628: file already attested");
        require(bytes(filename).length > 0, "627/628: empty filename");
        require(bytes(ipnsCid).length > 0, "627/628: empty IPNS");

        Attestation memory a = Attestation({
            fileHash: fileHash,
            filename: filename,
            jurisdiction: jurisdiction,
            timestamp: block.timestamp,
            submitter: msg.sender,
            ipnsCid: ipnsCid,
            transactionCount: transactionCount,
            totalValueCentavos: totalValueCentavos,
            valid: true
        });

        attestations[fileHash] = a;
        knownHashes[fileHash] = true;
        attestationList.push(fileHash);

        emit AttestationRegistered(
            fileHash,
            filename,
            jurisdiction,
            block.timestamp,
            msg.sender,
            ipnsCid,
            transactionCount,
            totalValueCentavos
        );
    }

    /**
     * @notice Register cross-jurisdiction match (e.g., same contributor in BR + US)
     */
    function registerCrossMatch(
        bytes32 brHash,
        bytes32 usHash,
        string calldata matchType
    ) external onlyGovernance {
        require(knownHashes[brHash], "627/628: BR hash unknown");
        require(knownHashes[usHash], "627/628: US hash unknown");
        emit CrossJurisdictionMatch(brHash, usHash, matchType, block.timestamp);
    }

    /**
     * @notice Flag an attestation as anomalous
     */
    function flagAnomaly(
        bytes32 fileHash,
        Jurisdiction jurisdiction,
        string calldata reason
    ) external onlyGovernance {
        require(knownHashes[fileHash], "627/628: unknown file");
        attestations[fileHash].valid = false;
        emit AnomalyDetected(fileHash, jurisdiction, reason, block.timestamp);
    }

    /**
     * @notice Retrieve attestation by hash
     */
    function getAttestation(bytes32 fileHash)
        external
        view
        returns (Attestation memory)
    {
        require(knownHashes[fileHash], "627/628: unknown file");
        return attestations[fileHash];
    }

    /**
     * @notice Batch query by jurisdiction
     */
    function getAttestationsByJurisdiction(Jurisdiction j, uint256 start, uint256 end)
        external
        view
        returns (Attestation[] memory)
    {
        require(start < end, "627/628: invalid range");
        Attestation[] memory batch = new Attestation[](end - start);
        uint256 count = 0;
        for (uint256 i = start; i < end && i < attestationList.length; i++) {
            if (attestations[attestationList[i]].jurisdiction == j) {
                batch[count] = attestations[attestationList[i]];
                count++;
            }
        }
        // Trim array (Solidity doesn't support dynamic resize, return full with zeros)
        return batch;
    }

    /**
     * @notice Get total attestations per jurisdiction
     */
    function getJurisdictionCount(Jurisdiction j) external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < attestationList.length; i++) {
            if (attestations[attestationList[i]].jurisdiction == j) {
                count++;
            }
        }
        return count;
    }

    /**
     * @notice Update governance (2/3 supermajority via Tokenic 624)
     */
    function updateGovernance(address newGov) external onlyGovernance {
        governance = newGov;
    }

    // ── Fallback ───────────────────────────────────────────────────────
    receive() external payable {
        revert("627/628: direct deposits not allowed");
    }
}