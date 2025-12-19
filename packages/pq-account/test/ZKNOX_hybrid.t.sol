// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";

import {Constants} from "ETHDILITHIUM/test/ZKNOX_seed.sol";
import {PythonSigner} from "ETHDILITHIUM/src/ZKNOX_PythonSigner.sol";
import {DeployPKContract} from "ETHDILITHIUM/script/Deploy_MLDSA_PK.s.sol";
import {DeployPKContract as DeployMLDSAETHPKContract} from "ETHDILITHIUM/script/Deploy_MLDSAETH_PK.s.sol";
import {Script_Deploy_Dilithium} from "ETHDILITHIUM/script/DeployDilithium.s.sol";
import {Script_Deploy_ETHDilithium} from "ETHDILITHIUM/script/DeployETHDilithium.s.sol";
import {Script_Deploy_ECDSA} from "ETHDILITHIUM/script/DeployECDSA.s.sol";

import {ZKNOX_HybridVerifier} from "../src/ZKNOX_hybrid.sol";

contract TestHybridVerifier is Test {
    address mldsaAddress;
    address mldsaEthAddress;
    address verifierAddress;
    address verifierEthAddress;
    address ecdsaVerifierAddress;

    PythonSigner pythonSigner = new PythonSigner();

    function setUp() public {
        // deploy the contract containing the MLDSA public key
        uint256 gasStart = gasleft();
        DeployPKContract deployPkContract = new DeployPKContract();
        mldsaAddress = deployPkContract.run();
        uint256 gasUsed = gasStart - gasleft();
        console.log("Gas used:", gasUsed);

        DeployMLDSAETHPKContract deployMldsaEthPkContract = new DeployMLDSAETHPKContract();
        mldsaEthAddress = deployMldsaEthPkContract.run();

        // deploy the contract containing the MLDSA core algorithm
        Script_Deploy_Dilithium deployVerifierContract = new Script_Deploy_Dilithium();
        verifierAddress = deployVerifierContract.run();

        // deploy the contract containing the MLDSAETH core algorithm
        Script_Deploy_ETHDilithium deployEthVerifierContract = new Script_Deploy_ETHDilithium();
        verifierEthAddress = deployEthVerifierContract.run();

        // deploy the contract containing the ECDSA core algorithm
        Script_Deploy_ECDSA deployEcdsaVerifierContract = new Script_Deploy_ECDSA();
        ecdsaVerifierAddress = deployEcdsaVerifierContract.run();
    }

    function testHybridVerify() public {
        ZKNOX_HybridVerifier hybrid;
        hybrid = new ZKNOX_HybridVerifier();
        address ethAddress = Constants.ADDR;

        bytes32 dataBytes32 = hex"1111222233334444111122223333444411112222333344441111222233334444";
        string memory data = vm.toString(dataBytes32);
        bytes memory preQuantumSig;
        bytes memory postQuantumSig;
        {
            string memory mode = "NIST";
            string memory seedStr = Constants.SEED_STR;
            (bytes memory cTilde, bytes memory z, bytes memory h, uint8 v, uint256 r, uint256 s) =
                pythonSigner.sign("lib/ETHDILITHIUM/pythonref", data, mode, seedStr);
            preQuantumSig = abi.encodePacked(r, s, v);
            postQuantumSig = abi.encodePacked(cTilde, z, h);
        }

        // Scope 3: Verify
        {
            uint256 gasStart = gasleft();
            bool valid = hybrid.isValid(
                abi.encodePacked(ethAddress),
                abi.encodePacked(mldsaAddress),
                ecdsaVerifierAddress,
                verifierAddress,
                dataBytes32,
                preQuantumSig,
                postQuantumSig
            );
            uint256 gasUsed = gasStart - gasleft();
            console.log("Gas used:", gasUsed);
            assertTrue(valid);
        }
    }

    function testHybridVerifyETH() public {
        ZKNOX_HybridVerifier hybrid;
        hybrid = new ZKNOX_HybridVerifier();
        address ethAddress = Constants.ADDR;

        bytes32 dataBytes32 = hex"1111222233334444111122223333444411112222333344441111222233334444";
        string memory data = vm.toString(dataBytes32);
        bytes memory preQuantumSig;
        bytes memory postQuantumSig;
        {
            string memory mode = "ETH";
            string memory seedStr = Constants.SEED_STR;
            (bytes memory cTilde, bytes memory z, bytes memory h, uint8 v, uint256 r, uint256 s) =
                pythonSigner.sign("lib/ETHDILITHIUM/pythonref", data, mode, seedStr);
            preQuantumSig = abi.encodePacked(r, s, v);
            postQuantumSig = abi.encodePacked(cTilde, z, h);
        }

        // Scope 3: Verify
        {
            uint256 gasStart = gasleft();
            bool valid = hybrid.isValid(
                abi.encodePacked(ethAddress),
                abi.encodePacked(mldsaEthAddress),
                ecdsaVerifierAddress,
                verifierEthAddress,
                dataBytes32,
                preQuantumSig,
                postQuantumSig
            );
            uint256 gasUsed = gasStart - gasleft();
            console.log("Gas used:", gasUsed);
            assertTrue(valid);
        }
    }
}
