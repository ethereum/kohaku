// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";

import {EntryPoint} from "account-abstraction/contracts/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {IStakeManager} from "account-abstraction/contracts/interfaces/IStakeManager.sol";
import {PackedUserOperation} from "account-abstraction/contracts/interfaces/PackedUserOperation.sol";

import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";

import {Signature} from "ETHDILITHIUM/src/ZKNOX_dilithium_utils.sol";

import {Constants} from "ETHDILITHIUM/test/ZKNOX_seed.sol";
import {PythonSigner} from "ETHDILITHIUM/src/ZKNOX_PythonSigner.sol";

import {ZKNOX_ERC4337_account} from "../src/ZKNOX_ERC4337_account.sol";

function bytes32ToHex(bytes32 value) pure returns (string memory) {
    return Strings.toHexString(uint256(value), 32);
}

contract TestERC4337_Account is Test {
    ZKNOX_ERC4337_account public account;
    IEntryPoint public entryPoint;

    address public recipient;
    Signature signature;

    PythonSigner pythonSigner = new PythonSigner();

    function setUp() public {
        // This is an example of ERC4337 account deployed on Sepolia, with MLDSA and ECDSA-k1
        // The seeds are provided below (cafe and deadbeef ;-))
        entryPoint = IEntryPoint(0x0000000071727De22E5E9d8BAf0edAc6f37da032);
        account = ZKNOX_ERC4337_account(0xe8D1C97379A823c0B434Cb5d976aD5098463bc22);
        
        // Fund the account
        vm.deal(address(account), 10 ether);

        recipient = 0xdA4e72C962C201D77d515B02dEd76B1a41E1DBab;
    }

    function testValidateUserOpSuccess() public {
        // Create a UserOperation
        PackedUserOperation memory userOp = _createUserOp();

        // Generate the userOpHash
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);

        // Sign the userOpHash with both MLDSA and ECDSA
        string memory data = bytes32ToHex(userOpHash);

        (bytes memory cTilde, bytes memory z, bytes memory h) =
            pythonSigner.sign(
                "lib/ETHDILITHIUM/pythonref",
                data,
                "NIST",
                "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
            );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            0xcafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe,
            userOpHash
        );
        bytes memory preQuantumSig = abi.encodePacked(r, s, v);
        bytes memory postQuantumSig = abi.encodePacked(cTilde, z, h);
        userOp.signature = abi.encode(preQuantumSig, postQuantumSig);
        console.log("SINGE");
        console.logBytes(userOp.signature);

        vm.prank(address(entryPoint));
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        // Check that validation succeeded (0 = success)
        assertEq(validationData, 0, "Signature validation should succeed");
    }

    function testValidateUserOpInvalidSignature() public {
        PackedUserOperation memory userOp = _createUserOp();
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);

        // Create invalid signatures
        (uint8 v, bytes32 r, bytes32 s) = (28, bytes32(0), bytes32(0));
        bytes memory cTilde = hex"00";
        bytes memory z = hex"00";
        bytes memory h = hex"00";
        bytes memory invalidPreQuantumSig = abi.encodePacked(r, s, v);
        bytes memory invalidPostQuantumSig = abi.encodePacked(cTilde, z, h);
        userOp.signature = abi.encode(invalidPreQuantumSig, invalidPostQuantumSig);

        vm.prank(address(entryPoint));
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        // Check that validation failed (1 = SIG_VALIDATION_FAILED)
        assertEq(validationData, 1, "Invalid signature should fail");
    }

    function testExecute() public {
        // Create a UserOperation
        PackedUserOperation memory userOp = _createUserOp();
        console.log("sender", userOp.sender);
        console.log("nonce", userOp.nonce);
        console.logBytes32(keccak256(userOp.initCode));
        console.logBytes32(keccak256(userOp.callData));
        console.logBytes32(userOp.accountGasLimits);
        console.log("preVerificationGas", userOp.preVerificationGas);
        console.logBytes32(userOp.gasFees);
        console.logBytes32(keccak256(userOp.paymasterAndData));
        console.logBytes32(entryPoint.getUserOpHash(userOp));

        // Generate the userOpHash
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);

        // Sign the userOpHash with both MLDSA and ECDSA
        string memory data = bytes32ToHex(userOpHash);
        console.log("Data");
        console.log(data);
        (bytes memory cTilde, bytes memory z, bytes memory h) =
            pythonSigner.sign(
                "lib/ETHDILITHIUM/pythonref",
                data,
                "NIST",
                "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
            );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            0xcafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe,
            userOpHash
        );
        bytes memory preQuantumSig = abi.encodePacked(r, s, v);
        bytes memory postQuantumSig = abi.encodePacked(cTilde, z, h);
        userOp.signature = abi.encode(preQuantumSig, postQuantumSig);
        console.log("Signature");
        console.logBytes(userOp.signature);

        // Create an array with a single UserOperation
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = userOp;

        vm.expectEmit(true, false, false, false, address(entryPoint));
        emit IStakeManager.Deposited(address(account), 0);
        emit IEntryPoint.BeforeExecution();
        emit IEntryPoint.UserOperationEvent(userOpHash, address(account), address(0), 0, true, 0, 0);

        // Call handleOps on the EntryPoint
        uint256 gasStart = gasleft();
        entryPoint.handleOps(ops, payable(recipient));
        uint256 gasUsed = gasStart - gasleft();
        console.log("Gas used:", gasUsed);
    }

    function _createUserOp() internal view returns (PackedUserOperation memory) {
        uint256 value = 0;
        bytes memory innerCallData = ""; // empty because recipient is an EOA

        // Encode the call to account.execute(recipient, value, innerCallData)
        bytes memory callData = abi.encodeWithSelector(
            account.execute.selector,
            recipient,
            value,
            innerCallData
        );

        console.log("CALLDATA");
        console.logBytes(callData); // for debugging

        return PackedUserOperation({
            sender: address(account),
            nonce: 0,
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32(abi.encodePacked(uint128(20_000_000), uint128(500_000))),
            preVerificationGas: 100000,
            gasFees: bytes32(abi.encodePacked(uint128(1 gwei), uint128(2 gwei))),
            paymasterAndData: "",
            signature: ""
        });
    }
}
