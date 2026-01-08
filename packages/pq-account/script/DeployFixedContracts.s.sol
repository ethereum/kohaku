pragma solidity ^0.8.25;

import {console} from "forge-std/Test.sol";

import {BaseScript} from "ETHDILITHIUM/script/BaseScript.sol";
import {ZKNOX_dilithium} from "ETHDILITHIUM/src/ZKNOX_dilithium.sol";
import {ZKNOX_ethdilithium} from "ETHDILITHIUM/src/ZKNOX_ethdilithium.sol";

import {ECDSAk1Verifier} from "InterfaceVerifier/VerifierECDSAk1.sol";
import {ECDSAr1Verifier} from "InterfaceVerifier/VerifierECDSAr1.sol";

import {ZKNOX_falcon} from "ETHFALCON/src/ZKNOX_falcon.sol";
import {ZKNOX_ethfalcon} from "ETHFALCON/src/ZKNOX_ethfalcon.sol";

import {ZKNOX_HybridVerifier} from "../src/ZKNOX_hybrid.sol";

// SPDX-License-Identifier: MIT
abstract contract VerifierDeployer is BaseScript {
    string internal saltLabel;
    
    function deployContract(bytes32 salt) internal virtual returns (address);
    
    function run() external returns (address) {
        vm.startBroadcast();
        
        bytes32 salt = keccak256(abi.encodePacked(saltLabel));
        address deployed = deployContract(salt);
        
        console.log(saltLabel, "deployed at:", deployed);
        console.log("Salt:");
        console.logBytes32(salt);
        
        vm.stopBroadcast();
        return deployed;
    }
}

contract MLDSAFixedContract is VerifierDeployer {
    constructor() {
        saltLabel = "ZKNOX_MLDSA_VERIFIER_V1";
    }
    function deployContract(bytes32 salt) internal override returns (address) {
        return address(new ZKNOX_dilithium{salt: salt}());
    }
}

contract MLDSAETHFixedContract is VerifierDeployer {
    constructor() {
        saltLabel = "ZKNOX_MLDSAETH_VERIFIER_V1";
    }
    function deployContract(bytes32 salt) internal override returns (address) {
        return address(new ZKNOX_ethdilithium{salt: salt}());
    }
}

contract FALCONFixedContract is VerifierDeployer {
    constructor() {
        saltLabel = "ZKNOX_FALCON_VERIFIER_V1";
    }
    function deployContract(bytes32 salt) internal override returns (address) {
        return address(new ZKNOX_falcon{salt: salt}());
    }
}

contract ETHFALCONFixedContract is VerifierDeployer {
    constructor() {
        saltLabel = "ZKNOX_ETHFALCON_VERIFIER_V1";
    }
    function deployContract(bytes32 salt) internal override returns (address) {
        return address(new ZKNOX_ethfalcon{salt: salt}());
    }
}

contract HybridVerifierFixedContract is VerifierDeployer {
    constructor() {
        saltLabel = "ZKNOX_HYBRID_VERIFIER_V1";
    }
    function deployContract(bytes32 salt) internal override returns (address) {
        return address(new ZKNOX_HybridVerifier{salt: salt}());
    }
}

contract ECDSAk1FixedContract is VerifierDeployer {
    constructor() {
        saltLabel = "ZKNOX_ECDSA_K1_VERIFIER_V1";
    }
    function deployContract(bytes32 salt) internal override returns (address) {
        return address(new ECDSAk1Verifier{salt: salt}());
    }
}

contract ECDSAr1FixedContract is VerifierDeployer {
    constructor() {
        saltLabel = "ZKNOX_ECDSA_R1_VERIFIER_V1";
    }
    function deployContract(bytes32 salt) internal override returns (address) {
        return address(new ECDSAr1Verifier{salt: salt}());
    }
}