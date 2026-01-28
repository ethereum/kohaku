// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ZKNOX_ERC4337_account} from "./ZKNOX_ERC4337_account.sol";

contract ZKNOX_AccountFactory {
    IEntryPoint public immutable ENTRY_POINT;
    address public immutable PRE_QUANTUM_LOGIC;
    address public immutable POST_QUANTUM_LOGIC;
    string VERSION;

    constructor(
        IEntryPoint _entryPoint,
        address _preQuantumLogic,
        address _postQuantumLogic,
        string memory _version
    ) {
        ENTRY_POINT = _entryPoint;
        PRE_QUANTUM_LOGIC = _preQuantumLogic;
        POST_QUANTUM_LOGIC = _postQuantumLogic;
        VERSION = _version;
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
            PRE_QUANTUM_LOGIC,
            POST_QUANTUM_LOGIC
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
                PRE_QUANTUM_LOGIC,
                POST_QUANTUM_LOGIC
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