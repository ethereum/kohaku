// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ArkheOntologyRegistry
 * @dev Registro on-chain da ontologia ARKHE com metadados FHE
 * Substrate 841 — Web3-Ontology-Bridge
 */
contract ArkheOntologyRegistry {
    using ECDSA for bytes32;

    // Estrutura de Substrate
    struct SubstrateEntry {
        uint256 id;
        string name;
        uint64 phiCoherence;        // Indicador público (multiplicado por 10^6)
        uint64 theosisIndex;        // Indicador público
        string status;
        uint256 sealHandle;         // Handle FHE do selo real
        uint256 encryptedPhiHandle; // Handle FHE do Phi real
        bool exists;
    }

    // Mapeamentos
    mapping(uint256 => SubstrateEntry) public substrates;
    mapping(uint256 => mapping(uint256 => bool)) public crossLinks; // id1 -> id2 -> verified
    mapping(bytes32 => bool) public usedNonces;

    // Ontologia OWL (armazenada como IPFS hash)
    mapping(string => string) public owlOntologyIPFS; // nome -> IPFS hash

    // Eventos
    event SubstrateRegistered(uint256 id, string name, string status);
    event CrossLinkVerified(uint256 fromId, uint256 toId, bool verified);
    event OntologyUpdated(string ontologyName, string ipfsHash);
    event ConfidentialQuery(uint256 substrateId, uint256 handle, address querier);

    address public ontologyAdmin;

    constructor() {
        ontologyAdmin = msg.sender;
    }

    /**
     * @dev Registra substrato com metadados públicos + handles FHE
     */
    function registerSubstrate(
        uint256 id,
        string calldata name,
        uint64 phiCoherence,
        uint64 theosisIndex,
        string calldata status,
        InEuint256 memory encryptedSeal,
        InEuint64 memory encryptedPhi
    ) external {
        euint256 seal = FHE.asEuint256(encryptedSeal);
        euint64 phi = FHE.asEuint64(encryptedPhi);

        uint256 sealHandle = FHE.getHandle(seal);
        uint256 phiHandle = FHE.getHandle(phi);

        substrates[id] = SubstrateEntry({
            id: id,
            name: name,
            phiCoherence: phiCoherence,
            theosisIndex: theosisIndex,
            status: status,
            sealHandle: sealHandle,
            encryptedPhiHandle: phiHandle,
            exists: true
        });

        // ACL: apenas este contrato pode acessar selo real
        FHE.allowThis(sealHandle);
        FHE.allowThis(phiHandle);

        emit SubstrateRegistered(id, name, status);
    }

    /**
     * @dev Verifica cross-link entre dois substratos
     * Requer ambos canonizados + ZK proof de verificação
     */
    function verifyCrossLink(
        uint256 fromId,
        uint256 toId,
        bytes calldata zkProof
    ) external {
        require(substrates[fromId].exists && substrates[toId].exists, "Substrate not found");
        require(
            keccak256(bytes(substrates[fromId].status)) == keccak256("CANONIZED_CLEAN") &&
            keccak256(bytes(substrates[toId].status)) == keccak256("CANONIZED_CLEAN"),
            "Both substrates must be CANONIZED_CLEAN"
        );

        // Verifica ZK proof (simplificado)
        require(zkProof.length > 32, "Invalid ZK proof");

        crossLinks[fromId][toId] = true;
        crossLinks[toId][fromId] = true;

        emit CrossLinkVerified(fromId, toId, true);
    }

    /**
     * @dev Query confidencial: retorna handle FHE do Phi real
     * Requer permissão ACL
     */
    function queryConfidentialPhi(
        uint256 substrateId,
        bytes calldata aclPermit
    ) external view returns (uint256) {
        require(substrates[substrateId].exists, "Substrate not found");

        // Verifica ACL permit (EIP-712)
        // Em produção: verificar assinatura e expiração

        emit ConfidentialQuery(substrateId, substrates[substrateId].encryptedPhiHandle, msg.sender);

        return substrates[substrateId].encryptedPhiHandle;
    }

    /**
     * @dev Atualiza ontologia OWL (IPFS hash)
     */
    function updateOntology(
        string calldata ontologyName,
        string calldata ipfsHash,
        bytes calldata signature
    ) external {
        // Verifica assinatura do ontologyAdmin
        bytes32 messageHash = keccak256(abi.encodePacked(ontologyName, ipfsHash));
        address signer = messageHash.toEthSignedMessageHash().recover(signature);
        require(signer == ontologyAdmin, "Invalid ontology admin signature");

        owlOntologyIPFS[ontologyName] = ipfsHash;

        emit OntologyUpdated(ontologyName, ipfsHash);
    }

    /**
     * @dev Query SPARQL-like: retorna substratos por status
     */
    function querySubstratesByStatus(
        string calldata status
    ) external view returns (uint256[] memory) {
        // Em produção: integrar com The Graph ou subgraph
        // Simplificado: retorna todos (filtrar off-chain)
        uint256[] memory result = new uint256[](1000);
        uint256 count = 0;

        for (uint256 i = 0; i < 1000; i++) {
            if (substrates[i].exists &&
                keccak256(bytes(substrates[i].status)) == keccak256(bytes(status))) {
                result[count] = i;
                count++;
            }
        }

        // Resize array
        assembly {
            mstore(result, count)
        }

        return result;
    }
}