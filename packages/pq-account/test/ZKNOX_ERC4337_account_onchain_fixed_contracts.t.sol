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
        account = ZKNOX_ERC4337_account(payable(0xe63546EF0AfC039A690891a83089541dc07225Fc));
        
        // Fund the account
        vm.deal(address(account), 10 ether);

        // simonmasson.eth ;-)
        recipient = 0xdA4e72C962C201D77d515B02dEd76B1a41E1DBab;
    }

    function testValidateUserOpSuccess() public {
        if (block.chainid != 421614) {
            vm.skip(true);
        }
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

        vm.prank(address(entryPoint));
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        // Check that validation succeeded (0 = success)
        assertEq(validationData, 0, "Signature validation should succeed");
    }

    function testValidateUserOpInvalidSignature() public {
        if (block.chainid != 421614) {
            vm.skip(true);
        }
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
        if (block.chainid != 421614) {
            vm.skip(true);
        }
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
        console.log("Data to be signed:");
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
        // userOp.signature = "0x000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000004124bedfbec72b35db770813abc870e17aba7d1c3ac62ddd65ea5f9b7dfbbae1de6b33aebd9def34bf14c55261dce6d65de5624e28f8893119bfe8af03d96bf5081b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000097499b3a4d43f5b211928b2a5f83448e29c8b36862a306d832fd4643b5b816a95ec86105ee75ad167dcee392a6c1a451150a520dee3721c96f54172abc1e63a1b092786132bae5bd2382c1acc18315a56ec660031905c97a9837a2378d3bf63471b6d7b4adfb010450cd93f2fc62d33e96ea6799392f93bcce8adc825499410e9e8a4595eb5e7f473dd5bb6081635693ab5960c2163a80086656e27a5a747d7bf5bb73d007f28d07305a5022a1f88f28747fec6971b855eaac25992e2f950e3d6cbd07e99978fec5bff8b9ef24a9d4bba91a8e48a7156614e1c8668fab4d75a48ee322cad9285908f57ae8cc2943b5849945500135e67aff4ea6d7f2c6e7a2d12097c609f07aa0f55b82c3c0ca5ebe6b8e3209a6a1aab6fb61cf2a4b84a1ed81ebed86aa9b6f613befd7a3c1056f43ea24c722652b4383bb9230b3dc842501e2e9c2998e69d186d413aa08277e0da1a325a8df518685142d68d4c5577892f6095b344ef6392d319a903a2b4542d55a87a82f4bdb09d7c382946213ff638a807a9d664a633e4b1234b878f35e1895ababc8edd1c14f4551c3be848780c29a8b192b9a444bc795250e703286c3265d45d6b92a06465370c84b7e4583532b7b85f16d7551753dcdb04747539d887c36bc73bcae4aed4ff1c864cbe4baa4b3b4858218cb2931e40545d3706a6fbb90f9f5b61b09787122ea0cd1d5c81aaaa71b3fed44f451cc5e9a965218a72820226a917eb383eba2334bce81abedfa78369e7c354a74b7b2d108aa652efe4df0d41cfa1e68cca256f3d600124409bf38a80ce3b77b311a173a09504ee55ee95e58868338d45f11aca3e64d09d6f914fcf60586324d69a41575d8505f29027e7b02698e6c6b1357ca3a2c2a6ec6ad2a9cb01005597e63a0a3112cf626f40a6a88cb8885f5dc701ad8757af759d8d806b8aa4ab7c1279cd951e861f1d3417d7fc9ef12d48953259bb1a53154ab3921eb65b8e027459dd6682985e926deffc4346c1a3728bb9b1fa476ee192da3d4aafd9be73c1330848818cb38aab5136b429523d5d971bd8bee409e2e960f240fcc00f47f011caca19d5da0cf46350875297ca1863940cdbb9a589ab784a1f4986b4c79c1f9745200be1bfa1f36b6699364933604b688683c55306e9824af3880d4c61b1440f2791abe0b96d6945e2599790aa010fcb096638b4ba59e592bf196d4684a16ab61b7d1034809261becbe7adc6d139be035610424f8bdc5e8cdba361606da137eecfcf3c7e56001cc93987821ee8c690589f56341350574527c39b6462a504188af492b3b011cc852ced66d57d1e956d1fbd299b1bdfdc2f6e07d7ff5418afcace62ea62884565238f35ca19d5ffbdfda8c66c4310da423a4bf11f8bf8253dcb5b04eb1201d4b2b5acbf9e4a8e46de6b2f385cdc3c6d63ff1c38d45a5caba2784174161bf7fa936da7059670a8e5bf4ce5c068a3f063a852794141d8fc0b3e478293c94a9217537acc665df495768e9482b810a177a1575e751f9bfbd6a08409a8d5d75ce3f8e164e816278c4cf65e5e179f7255717feb6cc8a23d2662cdd45bc2725d39acfec7cfd97136981e1e8026a0a068d2c749285efd3528313a00ba9e5032417ba686d2ac9e8ec0fc047ed2eea7bd00f07b00dcfd5739d31a262e90e03f52caaa7d87d7ef75f7cca019974a15fdfff6f84275543d68817be2e1ff813011937b30c21e8cb35ac464ccdac442b1949225f7770ddab59e6f16af1e959f38f02c189889aed490c5ad4b41f9204a34bb04e827c8d8ff841ca3892189c4f2c437d928b2d8a16c017d429884646b719a3cc14288cceb3a9da8a20769fb300da49d546aba49deab5a4fec739bb987aa59760307718b37e8a6d85880618417a18072cfbf0340a4652093d37b4265055c47f19b6acacf5f372ed0635f14e5c30448312c6b344dbbc68def810f797c09ceed31f0d8928418cee7cfd0ce038077376947af254c3d3749d8c65f1743ba867d4a38ea0c6248903ff69faf2c5555be33961dd2eaf0b23fc0d17df37490efaa2f73862a7b1cdad627ccb1d002b362dcc948d36229bf43b0f7b9a7d692fe73e97608c863169dfb9de31e8256e712e8355dafe9d13af68cfd14fab09ae52c816b5a20db0b0dfaf8f4769e89e2d401c24a2e31b2d55bbbc24bf0267a432a51953e1fad1e187597c4eb631a471662b513faf10d86147fe2f7d3ad0ddd0df5a7c53d24f9bbf6f6544d11693261280b22e026960d7be31ecadf0bb92bce53fcc8b0ae93bfde0a756f2558f4af862f35210354f961734149714c6af7917617a3dcedecd75550718fd0df19a69ddcbc6e07c9396f96df83fc7f20078ad20987eb6c8044c2f51110915cc204917ffe99ddfbc713a711a7871f014605f43191fdec4f871a5cd2c135601587d5085260b183882fadca29136058ef376263bbb341c5911cfa130f7bd0de7052e2eaae22b7d841ef44d59d89d186af50aa4ff4a21849460c3b540e879438f5e3176c343067bdb38af34b3fa2d940e10f317a4b108291fad28528ba3118e779588c43fa2688ec5cd94e39933c462726187c0d4a5a63a3bb780d82d05bf26a4677d72fd22cacb949116c4282cf02da16a192891a33c9cb4f78cc20be5b692a5e271d9038f12e6730a9f1b40d144de97a2fe00efc44ada85db736d5519cedd7f91bcef3e760f34426d879bc913e492f053dbe492ebb7b38a2dfc94a2ce4389bcbd929006f85bf462d5ee93fb84c01a8ba598f972db1f32a76b86fbc05fd264d666ff5c9154584e67ec4f24cb6a05f4cd9e5b5485b1d92ef14c0403f6963b93665c5d0b84ee723db3df64e67c62e8b83da27b341310da95e2d02a9583c50bdb3fa35a1a404f2ac9b75a4b1b159b0e6796fac90d6fd01de30bc3fb11119819760858fc52f7244aaed2e7336badf7c75a87e7fe92e638fe35e4d26da16373b15ba35fa0da3755dd5645cd6c8da3342ede2a79ba6a0467b6e49f8be27c5149b7dd557ecc95b5b4bddb6d01bfd4e59ccae1c9019b1df594ba9e63c5412ee9b3b58ff6621011f7a32a685485e2b05cd0505fb000e424dd081cec1daf2af6fc8118197e6a4077bdf3d5e7eafe04267ae80b2400a1ab7227f2dcfb1e26da006f289ff6d6af0d847ae244763803289c6d475557eb23a56bdaee0d083cd34f7d5402650ebb82090b569d445f19b0ded8aa29cb129fb8b3ff9a38a1fbdae6e5e78e72433aef207f5fdb65863e43f115f154d06e609b62949bbc5bdce34721ecad94adf1bcbb4e69437797e43a99e52074c2c4cda6ccf2b4b5883989daeb6c4d7e6e7fc102f3d758a999da2b0c9cbcccddee1213138444d52546b7e8798abb2b4bbbee8f5131f414a4f53646a7a828faab3c4d5dfe8e9fe0000000000000000000000000000000d1c2e41000000000000000000000000";
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
            nonce: entryPoint.getNonce(address(account), 0),
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32(abi.encodePacked(uint128(16_000_000), uint128(500_000))),
            preVerificationGas: 100000,
            gasFees: bytes32(abi.encodePacked(uint128(1 gwei), uint128(2 gwei))),
            paymasterAndData: "",
            signature: ""
        });
    }
}
