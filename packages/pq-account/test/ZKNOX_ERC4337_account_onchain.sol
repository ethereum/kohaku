// // SPDX-License-Identifier: UNLICENSED
// pragma solidity ^0.8.13;

// import {Test, console} from "forge-std/Test.sol";

// import {EntryPoint} from "account-abstraction/contracts/core/EntryPoint.sol";
// import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
// import {IStakeManager} from "account-abstraction/contracts/interfaces/IStakeManager.sol";
// import {PackedUserOperation} from "account-abstraction/contracts/interfaces/PackedUserOperation.sol";

// import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";

// import {Signature} from "ETHDILITHIUM/src/ZKNOX_dilithium_utils.sol";
// import {PKContract} from "ETHDILITHIUM/src/ZKNOX_PKContract.sol";
// import {Constants} from "ETHDILITHIUM/test/ZKNOX_seed.sol";
// import {PythonSigner} from "ETHDILITHIUM/src/ZKNOX_PythonSigner.sol";
// import {DeployPKContract} from "ETHDILITHIUM/script/Deploy_MLDSA_PK.s.sol";
// import {MLDSAFixedContract, HybridVerifierFixedContract} from "../script/DeployFixedContracts.s.sol";

// import {ZKNOX_ERC4337_account} from "../src/ZKNOX_ERC4337_account.sol";
// import {ZKNOX_HybridVerifier} from "../src/ZKNOX_hybrid.sol";

// function bytes32ToHex(bytes32 value) pure returns (string memory) {
//     return Strings.toHexString(uint256(value), 32);
// }

// contract TestERC4337_Account is Test {
//     // an example of ERC4337 account for Sepolia L1, with ECDSA-k1 and MLDSA-nist.
//     // this must be tested with
//     // `forge test test/ZKNOX_ERC4337_account_onchain.sol -j16 --rpc-url wss://ethereum-sepolia-rpc.publicnode.com -vvvv`
//     // TODO: add chainId check for these tests.
//     ZKNOX_ERC4337_account public account;
//     IEntryPoint public entryPoint;
//     PKContract public pkContract;
//     TestTarget target;
//     uint256 chainId = block.chainid;

//     address public owner;
//     uint256 public ownerPrivateKey;
//     Signature signature;

//     PythonSigner pythonSigner = new PythonSigner();

//     function setUp() public {
//         /**
//          * Setting for Sepolia L1 contracts
//          */

//         // address of a MLDSA PK stored on-chain (one per user)
//         address postQuantumAddress = address(0xCc28B19d743F3E139D6D8078B6600bad95CD7B2c);

//         // address of the deployed hybrid verifier
//         address hybridVerifierLogicAddress = address(0x78E229b83378DF8A9AC1164156b542eBbDE2a1D5);
//         // address of the deployed mldsa logic contract
//         address postQuantumLogicAddress = address(0xc15278300d4736C10c465E0f73b2D9eCC1c0d94B);
//         // address of the openzeppelin-deployed ECDSA-k1 logic contract (ERC7913)
//         address preQuantumLogicAddress = address(0x2AeC9200a5817fBdf235069B82E3b2EA24196ebC);

//         // Actually deploying the v0.8 EntryPoint
//         entryPoint = new EntryPoint();

//         (uint256 x, uint256 y) = vm.publicKeyP256(Constants.SEED_PREQUANTUM);
//         bytes memory preQuantumPubKey = abi.encodePacked(x, y);
//         bytes memory postQuantumPubKey = abi.encodePacked(postQuantumAddress);

//         // Deploy the Smart Account
//         account = new ZKNOX_ERC4337_account(
//             entryPoint,
//             preQuantumPubKey,
//             postQuantumPubKey,
//             preQuantumLogicAddress,
//             postQuantumLogicAddress,
//             hybridVerifierLogicAddress
//         );
//         // Deploy TestTarget
//         target = new TestTarget();

//         // Fund the account
//         vm.deal(address(account), 10 ether);

//         owner = 0x1234567890123456789012345678901234567890;
//     }

//     function testValidateUserOpSuccess() public {
//         if (chainId != 11155111) {
//             vm.skip(true);
//         }

//         // Create a UserOperation
//         PackedUserOperation memory userOp = _createUserOp();

//         // Generate the userOpHash
//         bytes32 userOpHash = entryPoint.getUserOpHash(userOp);

//         // Sign the userOpHash with both MLDSA and ECDSA
//         string memory data = bytes32ToHex(userOpHash);
//         string memory mode = "NIST";
//         string memory seedStr = Constants.SEED_POSTQUANTUM_STR;
//         (bytes memory cTilde, bytes memory z, bytes memory h) =
//             pythonSigner.sign("lib/ETHDILITHIUM/pythonref", data, mode, seedStr);
//         // overwrite with a p256 signature
//         (bytes32 r, bytes32 s) = vm.signP256(Constants.SEED_PREQUANTUM, userOpHash);
//         bytes memory preQuantumSig = abi.encodePacked(r, s);
//         bytes memory postQuantumSig = abi.encodePacked(cTilde, z, h);
//         userOp.signature = abi.encode(preQuantumSig, postQuantumSig);

//         vm.prank(address(entryPoint));
//         uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

//         // Check that validation succeeded (0 = success)
//         assertEq(validationData, 0, "Signature validation should succeed");
//     }

//     function testValidateUserOpInvalidSignature() public {
//         if (chainId != 11155111) {
//             vm.skip(true);
//         }
        
//         PackedUserOperation memory userOp = _createUserOp();
//         bytes32 userOpHash = entryPoint.getUserOpHash(userOp);

//         // Create invalid signatures
//         (bytes32 r, bytes32 s) = (bytes32(0), bytes32(0));
//         bytes memory cTilde = hex"00";
//         bytes memory z = hex"00";
//         bytes memory h = hex"00";
//         bytes memory invalidPreQuantumSig = abi.encodePacked(r, s);
//         bytes memory invalidPostQuantumSig = abi.encodePacked(cTilde, z, h);
//         userOp.signature = abi.encode(invalidPreQuantumSig, invalidPostQuantumSig);

//         vm.prank(address(entryPoint));
//         uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

//         // Check that validation failed (1 = SIG_VALIDATION_FAILED)
//         assertEq(validationData, 1, "Invalid signature should fail");
//     }

//     function testExecute() public {
//         if (chainId != 11155111) {
//             vm.skip(true);
//         }
        
//         // Create a UserOperation
//         PackedUserOperation memory userOp = _createUserOp();

//         // Generate the userOpHash
//         bytes32 userOpHash = entryPoint.getUserOpHash(userOp);

//         // Sign the userOpHash with both MLDSA and ECDSA
//         string memory data = bytes32ToHex(userOpHash);
//         string memory mode = "NIST";
//         string memory seedStr = Constants.SEED_POSTQUANTUM_STR;
//         (bytes memory cTilde, bytes memory z, bytes memory h) =
//             pythonSigner.sign("lib/ETHDILITHIUM/pythonref", data, mode, seedStr);
//         // overwrite with a p256 signature
//         (bytes32 r, bytes32 s) = vm.signP256(Constants.SEED_PREQUANTUM, userOpHash);
//         bytes memory preQuantumSig = abi.encodePacked(r, s);
//         bytes memory postQuantumSig = abi.encodePacked(cTilde, z, h);
//         userOp.signature = abi.encode(preQuantumSig, postQuantumSig);

//         // Create an array with a single UserOperation
//         PackedUserOperation[] memory ops = new PackedUserOperation[](1);
//         ops[0] = userOp;

//         vm.expectEmit(true, false, false, false, address(entryPoint));
//         emit IStakeManager.Deposited(address(account), 0);
//         emit IEntryPoint.BeforeExecution();
//         emit TestTarget.Hello("Hello from UserOp");
//         emit IEntryPoint.UserOperationEvent(userOpHash, address(account), address(0), 0, true, 0, 0);

//         // Call handleOps on the EntryPoint
//         uint256 gasStart = gasleft();
//         entryPoint.handleOps(ops, payable(owner));
//         uint256 gasUsed = gasStart - gasleft();
//         console.log("Gas used:", gasUsed);

//         assertEq(target.lastGreeting(), "Hello from UserOp", "Target call should succeed");
//     }

//     function _createUserOp() internal view returns (PackedUserOperation memory) {
//         // Encode the call to sayHello
//         bytes memory callData = abi.encodeWithSelector(
//             account.execute.selector,
//             address(target),
//             0,
//             abi.encodeWithSignature("sayHello(string)", "Hello from UserOp")
//         );

//         return PackedUserOperation({
//             sender: address(account),
//             nonce: 0,
//             initCode: "",
//             callData: callData,
//             accountGasLimits: bytes32(abi.encodePacked(uint128(20_000_000), uint128(500_000))),
//             preVerificationGas: 100000,
//             gasFees: bytes32(abi.encodePacked(uint128(1 gwei), uint128(2 gwei))),
//             paymasterAndData: "",
//             signature: ""
//         });
//     }
// }

// contract TestTarget {
//     event Hello(string greeting);
//     string public lastGreeting;

//     function sayHello(string memory greeting) external {
//         lastGreeting = greeting;
//         emit Hello(greeting);
//     }
// }
