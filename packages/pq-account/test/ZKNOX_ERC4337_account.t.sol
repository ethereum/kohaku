// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";

import {EntryPoint} from "account-abstraction/contracts/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {IStakeManager} from "account-abstraction/contracts/interfaces/IStakeManager.sol";
import {PackedUserOperation} from "account-abstraction/contracts/interfaces/PackedUserOperation.sol";

import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";

import {Signature} from "ETHDILITHIUM/src/ZKNOX_dilithium_utils.sol";
import {PKContract} from "ETHDILITHIUM/src/ZKNOX_PKContract.sol";
import {Constants} from "ETHDILITHIUM/test/ZKNOX_seed.sol";
import {PythonSigner} from "ETHDILITHIUM/src/ZKNOX_PythonSigner.sol";
import {DeployPKContract} from "ETHDILITHIUM/script/Deploy_MLDSA_PK.s.sol";
import {Script_Deploy_Dilithium} from "ETHDILITHIUM/script/DeployDilithium.s.sol";
import {Script_Deploy_ECDSA} from "ETHDILITHIUM/script/DeployECDSA.s.sol";

import {ZKNOX_ERC4337_account} from "../src/ZKNOX_ERC4337_account.sol";
import {ZKNOX_HybridVerifier} from "../src/ZKNOX_hybrid.sol";
import {Script_Deploy_Hybrid_Verifier} from "../script/DeployHybridVerifier.s.sol";

function bytes32ToHex(bytes32 value) pure returns (string memory) {
    return Strings.toHexString(uint256(value), 32);
}

contract TestERC4337_Account is Test {
    ZKNOX_ERC4337_account public account;
    IEntryPoint public entryPoint;
    ZKNOX_HybridVerifier public hybridVerifier;
    PKContract public pkContract;
    TestTarget target;

    address public owner;
    uint256 public ownerPrivateKey;
    Signature signature;

    PythonSigner pythonSigner = new PythonSigner();

    function setUp() public {
        /**
         *
         */

        DeployPKContract deployPkContract = new DeployPKContract();
        address postQuantumAddress = deployPkContract.run();

        Script_Deploy_Hybrid_Verifier scriptDeployHybridVerifier = new Script_Deploy_Hybrid_Verifier();
        address hybridVerifierLogicAddress = scriptDeployHybridVerifier.run();

        Script_Deploy_Dilithium scriptDeployDilithium = new Script_Deploy_Dilithium();
        address postQuantumLogicAddress = scriptDeployDilithium.run();

        Script_Deploy_ECDSA scriptDeployEcdsa = new Script_Deploy_ECDSA();
        address preQuantumLogicAddress = scriptDeployEcdsa.run();

        entryPoint = new EntryPoint();

        bytes memory preQuantumPubKey = abi.encodePacked(Constants.ADDR);
        bytes memory postQuantumPubKey = abi.encodePacked(postQuantumAddress);

        // Deploy the Smart Account
        account = new ZKNOX_ERC4337_account(
            entryPoint,
            preQuantumPubKey,
            postQuantumPubKey,
            preQuantumLogicAddress,
            postQuantumLogicAddress,
            hybridVerifierLogicAddress
        );
        // Deploy TestTarget
        target = new TestTarget();

        // Fund the account
        vm.deal(address(account), 10 ether);

        owner = 0x1234567890123456789012345678901234567890;
    }

    function testValidateUserOpSuccess() public {
        // Create a UserOperation
        PackedUserOperation memory userOp = _createUserOp();

        // Generate the userOpHash
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);

        // Sign the userOpHash with both MLDSA and ECDSA
        string memory data = bytes32ToHex(userOpHash);
        string memory mode = "NIST";
        string memory seedStr = Constants.SEED_STR;
        (bytes memory cTilde, bytes memory z, bytes memory h, uint8 v, uint256 r, uint256 s) =
            pythonSigner.sign("lib/ETHDILITHIUM/pythonref", data, mode, seedStr);
        bytes memory preQuantumSig = abi.encodePacked(r, s, v);
        bytes memory postQuantumSig = abi.encodePacked(cTilde, z, h);
        userOp.signature = abi.encode(preQuantumSig, postQuantumSig);

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

        // Generate the userOpHash
        bytes32 userOpHash = entryPoint.getUserOpHash(userOp);

        // Sign the userOpHash with both MLDSA and ECDSA
        string memory data = bytes32ToHex(userOpHash);
        string memory mode = "NIST";
        string memory seedStr = Constants.SEED_STR;
        (bytes memory cTilde, bytes memory z, bytes memory h, uint8 v, uint256 r, uint256 s) =
            pythonSigner.sign("lib/ETHDILITHIUM/pythonref", data, mode, seedStr);
        bytes memory preQuantumSig = abi.encodePacked(r, s, v);
        bytes memory postQuantumSig = abi.encodePacked(cTilde, z, h);
        userOp.signature = abi.encode(preQuantumSig, postQuantumSig);

        // Create an array with a single UserOperation
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = userOp;

        vm.expectEmit(true, false, false, false, address(entryPoint));
        emit IStakeManager.Deposited(address(account), 0);
        emit IEntryPoint.BeforeExecution();
        emit TestTarget.Hello("Hello from UserOp");
        emit IEntryPoint.UserOperationEvent(userOpHash, address(account), address(0), 0, true, 0, 0);

        // Call handleOps on the EntryPoint
        uint256 gasStart = gasleft();
        entryPoint.handleOps(ops, payable(owner));
        uint256 gasUsed = gasStart - gasleft();
        console.log("Gas used:", gasUsed);

        assertEq(target.lastGreeting(), "Hello from UserOp", "Target call should succeed");
    }

    function _createUserOp() internal view returns (PackedUserOperation memory) {
        // Encode the call to sayHello
        bytes memory callData = abi.encodeWithSelector(
            account.execute.selector,
            address(target),
            0,
            abi.encodeWithSignature("sayHello(string)", "Hello from UserOp")
        );

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

contract TestTarget {
    event Hello(string greeting);
    string public lastGreeting;

    function sayHello(string memory greeting) external {
        lastGreeting = greeting;
        emit Hello(greeting);
    }
}
