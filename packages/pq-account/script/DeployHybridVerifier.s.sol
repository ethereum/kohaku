pragma solidity ^0.8.25;

import {console} from "forge-std/Test.sol";
import {BaseScript} from "ETHDILITHIUM/script/BaseScript.sol";
import {ZKNOX_HybridVerifier} from "../src/ZKNOX_hybrid.sol";
// import {DeployPKContract} from "ETHDILITHIUM/script/Deploy_MLDSA_PK.s.sol";
// import {Script_Deploy_Dilithium} from "ETHDILITHIUM/script/DeployDilithium.s.sol";
// import {Script_Deploy_ECDSA} from "ETHDILITHIUM/script/DeployECDSA.s.sol";
// import {Constants} from "ETHDILITHIUM/test/ZKNOX_seed.sol";

contract Script_Deploy_Hybrid_Verifier is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        // address preQuantumAddress = Constants.ADDR;
        // DeployPKContract deployPkContract = new DeployPKContract();
        // address postQuantumAddress = deployPkContract.run();
        // Script_Deploy_ECDSA scriptDeployEcdsa = new Script_Deploy_ECDSA();
        // address preQuantumLogicAddress = scriptDeployEcdsa.run();
        // Script_Deploy_Dilithium scriptDeployDilithium = new Script_Deploy_Dilithium();
        // address postQuantumLogicAddress = scriptDeployDilithium.run();

        vm.startBroadcast();

        ZKNOX_HybridVerifier hybridVerifier = new ZKNOX_HybridVerifier();
        console.log("hybridVerifier deployed at:", address(hybridVerifier));

        // bytes32 data = hex"1111222233334444111122223333444411112222333344441111222233334444";
        // bytes memory preQuantumSig;
        // bytes memory postQuantumSig;
        // {
        //     string[] memory cmds = new string[](5);
        //     cmds[0] = "pythonref/myenv/bin/python";
        //     cmds[1] = "pythonref/sig_hybrid.py";
        //     cmds[2] = vm.toString(data);
        //     cmds[3] = "NIST";
        //     cmds[4] = Constants.SEED_STR;

        //     bytes memory result = vm.ffi(cmds);
        //     (bytes memory cTilde, bytes memory z, bytes memory h, uint8 v, uint256 r, uint256 s) =
        //         abi.decode(result, (bytes, bytes, bytes, uint8, uint256, uint256));

        //     preQuantumSig = abi.encodePacked(r, s, v);
        //     postQuantumSig = abi.encodePacked(cTilde, z, h);
        // }

        // // Scope 3: Verify
        // bool valid = hybridVerifier.isValid(
        //     abi.encodePacked(preQuantumAddress),
        //     abi.encodePacked(postQuantumAddress),
        //     preQuantumLogicAddress,
        //     postQuantumLogicAddress,
        //     data,
        //     preQuantumSig,
        //     postQuantumSig
        // );
        // console.log(valid);
        // if (valid == false) revert("verification failure");

        vm.stopBroadcast();
        return address(hybridVerifier);
    }
}
