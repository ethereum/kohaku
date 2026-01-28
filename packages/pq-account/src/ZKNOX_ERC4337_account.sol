// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BaseAccount, PackedUserOperation} from "account-abstraction/contracts/core/BaseAccount.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS} from "account-abstraction/contracts/core/Helpers.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ISigVerifier} from "InterfaceVerifier/IVerifier.sol";

contract ZKNOX_ERC4337_account is BaseAccount {
    IEntryPoint private _entryPoint;
    bytes private preQuantumPubKey;
    bytes private postQuantumPubKey;
    address private preQuantumLogicContractAddress;
    address private postQuantumLogicContractAddress;

    constructor(
        IEntryPoint _entryPoint0,
        bytes memory _preQuantumPubKey,
        bytes memory _postQuantumPubKey,
        address _preQuantumLogicContractAddress,
        address _postQuantumLogicContractAddress
    ) {
        _entryPoint = _entryPoint0;
        // prequantum logic and key
        preQuantumLogicContractAddress = _preQuantumLogicContractAddress;
        preQuantumPubKey = ISigVerifier(preQuantumLogicContractAddress).setKey(_preQuantumPubKey);
        // postquantum logic and key
        postQuantumLogicContractAddress = _postQuantumLogicContractAddress;
        postQuantumPubKey = ISigVerifier(postQuantumLogicContractAddress).setKey(_postQuantumPubKey);
    }

    /// @inheritdoc BaseAccount
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    /// @notice Verify hybrid signature (pre- and post-quantum)
    /// @param preQPubKey is a pre-quantum public key
    /// @param postQPubKey is a post-quantum public key
    /// @param preQLogicContractAddress the logic of the pre-quantum verification
    /// @param postQLogicContractAddress the logic of the post-quantum verification
    /// @param digest The data that was signed
    /// @param preQuantumSig the pre-quantum signature: [r, s, v] for k1, [r, s] for r1
    /// @param postQuantumSig the post-quantum signature (depending on the scheme)
    /// @return true if both signatures are valid
    function isValid(
        bytes memory preQPubKey,
        bytes memory postQPubKey,
        address preQLogicContractAddress,
        address postQLogicContractAddress,
        bytes32 digest,
        bytes memory preQuantumSig,
        bytes memory postQuantumSig
    ) public view returns (bool) {
        // Validate digest length
        if (digest.length > 32) {
            return false;
        }

        // Verify pre-quantum signature
        ISigVerifier preQuantumCore = ISigVerifier(preQLogicContractAddress);
        if (preQuantumCore.verify(preQPubKey, digest, preQuantumSig) != preQuantumCore.verify.selector) {
            return false;
        }

        // Verify post-quantum signature
        ISigVerifier postQuantumCore = ISigVerifier(postQLogicContractAddress);
        if (postQuantumCore.verify(postQPubKey, digest, postQuantumSig) != postQuantumCore.verify.selector) {
            return false;
        }
        return true;
    }

    /// @inheritdoc BaseAccount
    function _validateSignature(PackedUserOperation calldata userOp, bytes32 userOpHash)
        internal
        virtual
        override
        returns (uint256 validationData)
    {
        (bytes memory preQuantumSig, bytes memory postQuantumSig) = abi.decode(userOp.signature, (bytes, bytes));
        bool result = isValid(
            preQuantumPubKey,
            postQuantumPubKey,
            preQuantumLogicContractAddress,
            postQuantumLogicContractAddress,
            userOpHash,
            preQuantumSig,
            postQuantumSig
        );
        if (!result) {
            return SIG_VALIDATION_FAILED;
        }
        return SIG_VALIDATION_SUCCESS;
    }

    receive() external payable {}
    fallback() external payable {}
}
