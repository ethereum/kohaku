// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ZKNOX_ERC4337_account} from "./ZKNOX_ERC4337_account.sol";

contract ZKNOX_AccountFactory {
    IEntryPoint public immutable entryPoint;
    address public immutable preQuantumLogic;
    address public immutable postQuantumLogic;
    address public immutable hybridVerifierLogic;

    constructor(
        IEntryPoint _entryPoint,
        address _preQuantumLogic,
        address _postQuantumLogic,
        address _hybridVerifierLogic
    ) {
        entryPoint = _entryPoint;
        preQuantumLogic = _preQuantumLogic;
        postQuantumLogic = _postQuantumLogic;
        hybridVerifierLogic = _hybridVerifierLogic;
    }

    function createAccount(
        bytes calldata preQuantumPubKey,
        bytes calldata postQuantumPubKey
    ) external returns (ZKNOX_ERC4337_account) {
        address addr = getAddress(preQuantumPubKey, postQuantumPubKey);
        if (addr.code.length > 0) {
            return ZKNOX_ERC4337_account(addr);
        }
        bytes32 salt = keccak256(abi.encodePacked(preQuantumPubKey, postQuantumPubKey));
        return new ZKNOX_ERC4337_account{salt: salt}(
            entryPoint,
            preQuantumPubKey,
            postQuantumPubKey,
            preQuantumLogic,
            postQuantumLogic,
            hybridVerifierLogic
        );
    }

    function getAddress(
        bytes calldata preQuantumPubKey,
        bytes calldata postQuantumPubKey
    ) public view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(preQuantumPubKey, postQuantumPubKey));
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            salt,
            keccak256(abi.encodePacked(
                type(ZKNOX_ERC4337_account).creationCode,
                abi.encode(
                    entryPoint,
                    preQuantumPubKey,
                    postQuantumPubKey,
                    preQuantumLogic,
                    postQuantumLogic,
                    hybridVerifierLogic
                )
            ))
        )))));
    }
}