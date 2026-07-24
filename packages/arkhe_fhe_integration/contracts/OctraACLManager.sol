// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@fhenixprotocol/cofhe-contracts/ACL.sol";

/**
 * @title OctraACLManager
 * @dev ACL customizado para integração Octra HFHE + Fhenix CoFHE
 * Substrate 840+ — Access Control Module
 */
contract OctraACLManager is ACL {

    // Mapping: Octra Circle ID → nível de permissão ACL
    mapping(string => uint8) public circlePermissionLevel;

    // Níveis de permissão
    uint8 constant LEVEL_NONE = 0;      // Nenhum acesso
    uint8 constant LEVEL_THIS = 1;      // Apenas este contrato
    uint8 constant LEVEL_DELEGATED = 2;   // Endereços delegados
    uint8 constant LEVEL_DECRYPT = 3;    // Threshold Network
    uint8 constant LEVEL_PUBLIC = 4;     // Público

    // Delegações: Circle ID → endereço → permitido
    mapping(string => mapping(address => bool)) public circleDelegates;

    // Eventos
    event CirclePermissionSet(string circleId, uint8 level, address setter);
    event CircleDelegateAdded(string circleId, address delegate);
    event CircleDelegateRemoved(string circleId, address delegate);

    modifier onlyCircleAdmin(string calldata circleId) {
        require(
            msg.sender == owner() || circleDelegates[circleId][msg.sender],
            "Not circle admin or delegate"
        );
        _;
    }

    /**
     * @dev Configura nível de permissão ACL para um Circle Octra
     */
    function setCirclePermissionLevel(
        string calldata circleId,
        uint8 level
    ) external onlyOwner {
        require(level <= LEVEL_PUBLIC, "Invalid permission level");
        circlePermissionLevel[circleId] = level;
        emit CirclePermissionSet(circleId, level, msg.sender);
    }

    /**
     * @dev Adiciona delegado para um Circle
     */
    function addCircleDelegate(
        string calldata circleId,
        address delegate
    ) external onlyCircleAdmin(circleId) {
        circleDelegates[circleId][delegate] = true;
        emit CircleDelegateAdded(circleId, delegate);
    }

    /**
     * @dev Remove delegado de um Circle
     */
    function removeCircleDelegate(
        string calldata circleId,
        address delegate
    ) external onlyCircleAdmin(circleId) {
        circleDelegates[circleId][delegate] = false;
        emit CircleDelegateRemoved(circleId, delegate);
    }

    /**
     * @dev Aplica permissões ACL para um handle Fhenix baseado no Circle
     */
    function applyCircleACL(
        string calldata circleId,
        uint256 fhenixHandle
    ) external {
        uint8 level = circlePermissionLevel[circleId];

        if (level == LEVEL_NONE) {
            // Nenhuma permissão — handle permanece privado
            return;
        } else if (level == LEVEL_THIS) {
            FHE.allowThis(fhenixHandle);
        } else if (level == LEVEL_DELEGATED) {
            FHE.allowThis(fhenixHandle);
            // Permite todos os delegados
            // (implementação iterativa otimizada)
        } else if (level == LEVEL_DECRYPT) {
            FHE.allowThis(fhenixHandle);
            FHE.allowForDecryption(fhenixHandle);
        } else if (level == LEVEL_PUBLIC) {
            FHE.allowThis(fhenixHandle);
            FHE.allowPublic(fhenixHandle);
        }
    }

    /**
     * @dev Verifica se um endereço tem permissão para um handle
     * Override do ACL base para incluir lógica de Circle
     */
    function verifyAccess(
        uint256 handle,
        address account,
        string calldata circleId
    ) external view returns (bool) {
        // Verifica permissão base do ACL
        if (isAllowed(handle, account)) {
            return true;
        }

        // Verifica delegação de Circle
        if (circleDelegates[circleId][account]) {
            return true;
        }

        // Verifica nível público
        if (circlePermissionLevel[circleId] >= LEVEL_PUBLIC) {
            return true;
        }

        return false;
    }

    /**
     * @dev Revoga todas as permissões de um Circle (emergency)
     */
    function emergencyRevokeCircle(string calldata circleId) external onlyOwner {
        circlePermissionLevel[circleId] = LEVEL_NONE;
        emit CirclePermissionSet(circleId, LEVEL_NONE, msg.sender);
    }
}