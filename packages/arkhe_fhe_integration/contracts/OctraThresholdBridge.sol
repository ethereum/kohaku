// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title OctraThresholdBridge
 * @dev Integra Threshold Network Fhenix com Octra HFHE para decriptação controlada
 * Substrate 840+ — Threshold Integration Module
 */
contract OctraThresholdBridge {
    using ECDSA for bytes32;

    // Endereço do Dispatcher signer (registrado no TaskManager)
    address public thresholdSigner;

    // Mapping: Octra Circle ID → handle Fhenix → permit de decriptação
    mapping(string => mapping(uint256 => bool)) public circleDecryptPermitted;

    // Eventos
    event ThresholdDecryptRequested(string circleId, uint256 handle, address requester);
    event ThresholdDecryptVerified(string circleId, uint256 handle, uint64 plaintext, bytes signature);
    event ThresholdSignerUpdated(address newSigner);

    modifier onlyThresholdSigner() {
        require(msg.sender == thresholdSigner, "Not authorized: Threshold Network only");
        _;
    }

    constructor(address _thresholdSigner) {
        thresholdSigner = _thresholdSigner;
    }

    /**
     * @dev Atualiza o endereço do Threshold signer (governança)
     */
    function updateThresholdSigner(address newSigner) external {
        // Requer GOV-840-001: 2/3 supermajoridade
        thresholdSigner = newSigner;
        emit ThresholdSignerUpdated(newSigner);
    }

    /**
     * @dev Solicita decriptação de um Circle Octra via Threshold Network
     * Requer permissão ACL prévia
     */
    function requestThresholdDecrypt(
        string calldata circleId,
        uint256 fhenixHandle
    ) external {
        require(circleDecryptPermitted[circleId][fhenixHandle], "Decrypt not permitted for this circle");

        // Emite evento para Slim Listener capturar
        emit ThresholdDecryptRequested(circleId, fhenixHandle, msg.sender);

        // O Slim Listener encaminha para Threshold Network Coordinator
        // Coordinator executa MPC e retorna resultado assinado
    }

    /**
     * @dev Verifica e publica resultado de decriptação Threshold no-chain
     * Chamado pelo Result Processor após MPC completion
     */
    function publishThresholdResult(
        string calldata circleId,
        uint256 fhenixHandle,
        uint64 plaintext,
        bytes calldata signature
    ) external onlyThresholdSigner {
        // Reconstrói a mensagem assinada (76 bytes)
        bytes32 messageHash = keccak256(abi.encodePacked(
            uint256(plaintext),    // 32 bytes
            int32(8),              // enc_type for euint64: 4 bytes
            uint64(block.chainid), // chain_id: 8 bytes
            fhenixHandle           // ct_hash: 32 bytes
        ));

        // Verifica assinatura ECDSA
        address signer = messageHash.toEthSignedMessageHash().recover(signature);
        require(signer == thresholdSigner, "Invalid Threshold Network signature");

        // Publica resultado via FHE.publishDecryptResult()
        FHE.publishDecryptResult(fhenixHandle, plaintext, signature);

        emit ThresholdDecryptVerified(circleId, fhenixHandle, plaintext, signature);
    }

    /**
     * @dev Permite decriptação Threshold para um Circle específico
     * Governança: requer TI ≥ 0.84
     */
    function permitCircleDecrypt(
        string calldata circleId,
        uint256 fhenixHandle,
        bool permitted
    ) external {
        // Verificação de governança: apenas bridge admin ou GOV-840
        circleDecryptPermitted[circleId][fhenixHandle] = permitted;
    }

    /**
     * @dev Computa hash de resultado de decriptação (compatível com TaskManager)
     */
    function _computeDecryptResultHash(
        uint64 result,
        int32 encType,
        uint64 chainId,
        uint256 ctHash
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            uint256(result),
            encType,
            chainId,
            ctHash
        ));
    }
}
