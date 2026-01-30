// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ZKNOX_ERC4337_account} from "./ZKNOX_ERC4337_account.sol";

contract ZKNOX_AccountFactory {
    IEntryPoint public immutable ENTRY_POINT;
    
    // Point 5: Retrait de immutable pour permettre les mises à jour
    address public preQuantumLogic;
    address public postQuantumLogic;
    
    // Point 4 & 6: VERSION est maintenant public (getter auto-généré)
    string public VERSION;
    
    // Point 5: Owner pour contrôler les mises à jour
    address public owner;

    // Events pour le tracking des mises à jour
    event PreQuantumLogicUpdated(address indexed oldLogic, address indexed newLogic);
    event PostQuantumLogicUpdated(address indexed oldLogic, address indexed newLogic);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error OnlyOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(
        IEntryPoint _entryPoint,
        address _preQuantumLogic,
        address _postQuantumLogic,
        string memory _version
    ) {
        if (address(_entryPoint) == address(0)) revert ZeroAddress();
        if (_preQuantumLogic == address(0)) revert ZeroAddress();
        if (_postQuantumLogic == address(0)) revert ZeroAddress();
        
        ENTRY_POINT = _entryPoint;
        preQuantumLogic = _preQuantumLogic;
        postQuantumLogic = _postQuantumLogic;
        VERSION = _version;
        owner = msg.sender;
    }

    // Point 5: Fonctions de mise à jour des logic contracts
    
    /// @notice Met à jour le contrat de logique pre-quantum
    /// @param _newPreQuantumLogic Nouvelle adresse du verifier pre-quantum
    function setPreQuantumLogic(address _newPreQuantumLogic) external onlyOwner {
        if (_newPreQuantumLogic == address(0)) revert ZeroAddress();
        address oldLogic = preQuantumLogic;
        preQuantumLogic = _newPreQuantumLogic;
        emit PreQuantumLogicUpdated(oldLogic, _newPreQuantumLogic);
    }

    /// @notice Met à jour le contrat de logique post-quantum
    /// @param _newPostQuantumLogic Nouvelle adresse du verifier post-quantum
    function setPostQuantumLogic(address _newPostQuantumLogic) external onlyOwner {
        if (_newPostQuantumLogic == address(0)) revert ZeroAddress();
        address oldLogic = postQuantumLogic;
        postQuantumLogic = _newPostQuantumLogic;
        emit PostQuantumLogicUpdated(oldLogic, _newPostQuantumLogic);
    }

    /// @notice Met à jour les deux logic contracts en une seule transaction
    /// @param _newPreQuantumLogic Nouvelle adresse du verifier pre-quantum
    /// @param _newPostQuantumLogic Nouvelle adresse du verifier post-quantum
    function setLogicContracts(
        address _newPreQuantumLogic,
        address _newPostQuantumLogic
    ) external onlyOwner {
        if (_newPreQuantumLogic == address(0)) revert ZeroAddress();
        if (_newPostQuantumLogic == address(0)) revert ZeroAddress();
        
        address oldPreLogic = preQuantumLogic;
        address oldPostLogic = postQuantumLogic;
        
        preQuantumLogic = _newPreQuantumLogic;
        postQuantumLogic = _newPostQuantumLogic;
        
        emit PreQuantumLogicUpdated(oldPreLogic, _newPreQuantumLogic);
        emit PostQuantumLogicUpdated(oldPostLogic, _newPostQuantumLogic);
    }

    /// @notice Transfère la propriété du contrat
    /// @param _newOwner Nouvelle adresse du propriétaire
    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = _newOwner;
        emit OwnershipTransferred(oldOwner, _newOwner);
    }

    function createAccount(
        bytes calldata preQuantumPubKey,
        bytes calldata postQuantumPubKey
    ) external returns (ZKNOX_ERC4337_account) {
        address payable addr = getAddress(preQuantumPubKey, postQuantumPubKey);
        if (addr.code.length > 0) {
            return ZKNOX_ERC4337_account(addr);
        }
        bytes32 salt = keccak256(abi.encodePacked(preQuantumPubKey, postQuantumPubKey, VERSION));
        return new ZKNOX_ERC4337_account{salt: salt}(
            ENTRY_POINT,
            preQuantumPubKey,
            postQuantumPubKey,
            preQuantumLogic,
            postQuantumLogic
        );
    }

    function getAddress(
        bytes calldata preQuantumPubKey,
        bytes calldata postQuantumPubKey
    ) public view returns (address payable) {
        bytes32 salt = keccak256(abi.encodePacked(preQuantumPubKey, postQuantumPubKey, VERSION));
        bytes32 bytecodeHash = keccak256(abi.encodePacked(
            type(ZKNOX_ERC4337_account).creationCode,
            abi.encode(
                ENTRY_POINT,
                preQuantumPubKey,
                postQuantumPubKey,
                preQuantumLogic,
                postQuantumLogic
            )
        ));
        bytes32 rawAddress = keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            salt,
            bytecodeHash
        ));
        return payable(address(uint160(uint256(rawAddress))));
    }
}
