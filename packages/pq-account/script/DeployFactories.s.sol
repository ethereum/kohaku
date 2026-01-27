// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {console} from "forge-std/Test.sol";
import {BaseScript} from "ETHDILITHIUM/script/BaseScript.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ZKNOX_AccountFactory} from "../src/ZKNOX_PQFactory.sol";

abstract contract FactoryDeployer is BaseScript {
    // EntryPoint v0.7 canonical address
    address constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    
    string internal saltLabel;
    string internal preQuantumKey;   // json key name for pre-quantum verifier
    string internal postQuantumKey;  // json key name for post-quantum verifier
    string internal factoryName;     // name for this factory deployment
    
    function run() external returns (address) {
        string memory json = vm.readFile("deployments/deployments.json");
        
        // Get network name from chainId
        string memory network;
        if (block.chainid == 11155111) {
            network = "sepolia";
        } else if (block.chainid == 1) {
            network = "mainnet";
        } else if (block.chainid == 421614) {
            network = "arbitrumSepolia";
        } else {
            revert("Unsupported chain");
        }
        
        // Read verifier addresses from JSON
        string memory basePath = string.concat(".", network);
        address preQuantumVerifier = vm.parseJsonAddress(
            json, 
            string.concat(basePath, ".verifiers.", preQuantumKey, ".address")
        );
        address postQuantumVerifier = vm.parseJsonAddress(
            json, 
            string.concat(basePath, ".verifiers.", postQuantumKey, ".address")
        );
        
        // Compute salt from label
        bytes32 salt = keccak256(abi.encodePacked(saltLabel));
        
        console.log("Deploying", factoryName, "on", network);
        console.log("  Salt label:", saltLabel);
        console.log("  Salt:", vm.toString(salt));
        console.log("  EntryPoint:", ENTRYPOINT_V07);
        console.log("  PreQuantum:", preQuantumKey, "at", preQuantumVerifier);
        console.log("  PostQuantum:", postQuantumKey, "at", postQuantumVerifier);
        
        vm.startBroadcast();
        ZKNOX_AccountFactory factory = new ZKNOX_AccountFactory{salt: salt}(
            IEntryPoint(ENTRYPOINT_V07),
            preQuantumVerifier,
            postQuantumVerifier,
            saltLabel
        );
        vm.stopBroadcast();
        
        console.log("Factory deployed at:", address(factory));
        
        // Update JSON with factory deployment info
        string memory outputJson = vm.serializeAddress(factoryName, "address", address(factory));
        outputJson = vm.serializeBytes32(factoryName, "salt", salt);
        outputJson = vm.serializeString(factoryName, "saltLabel", saltLabel);
        outputJson = vm.serializeString(factoryName, "preQuantum", preQuantumKey);
        outputJson = vm.serializeString(factoryName, "postQuantum", postQuantumKey);
        
        // Write to accounts array or specific account field
        vm.writeJson(
            outputJson, 
            "deployments/deployments.json", 
            string.concat(basePath, ".accounts.", factoryName)
        );
        
        console.log("Updated deployments.json at", string.concat(basePath, ".accounts.", factoryName));
        
        return address(factory);
    }
}

// Default factory: ECDSA K1 + MLDSA
contract MLDSA_ECDSAk1_Factory is FactoryDeployer {
    constructor() {
        saltLabel = "ZKNOX_MLDSA_K1_FACTORY_V0_0_7";
        preQuantumKey = "ecdsa_k1";
        postQuantumKey = "mldsa";
        factoryName = "mldsa_k1";
    }
}

// Factory: ECDSA K1 + MLDSAETH
contract MLDSAETH_ECDSAk1_Factory is FactoryDeployer {
    constructor() {
        saltLabel = "ZKNOX_MLDSAETH_K1_FACTORY_V0_0_1";
        preQuantumKey = "ecdsa_k1";
        postQuantumKey = "mldsaeth";
        factoryName = "mldsaeth_k1";
    }
}

// Factory: ECDSA R1 + MLDSA
contract MLDSA_ECDSAr1_Factory is FactoryDeployer {
    constructor() {
        saltLabel = "ZKNOX_MLDSA_R1_FACTORY_V0_0_1";
        preQuantumKey = "ecdsa_r1";
        postQuantumKey = "mldsa";
        factoryName = "mldsa_r1";
    }
}

// Factory: ECDSA R1 + MLDSAETH
contract MLDSAETH_ECDSAr1_Factory is FactoryDeployer {
    constructor() {
        saltLabel = "ZKNOX_MLDSAETH_R1_FACTORY_V0_0_1";
        preQuantumKey = "ecdsa_r1";
        postQuantumKey = "mldsaeth";
        factoryName = "mldsaeth_r1";
    }
}

// Factory: ECDSA K1 + FALCON
contract FALCON_ECDSAk1_Factory is FactoryDeployer {
    constructor() {
        saltLabel = "ZKNOX_FALCON_K1_FACTORY_V0_0_1";
        preQuantumKey = "ecdsa_k1";
        postQuantumKey = "falcon";
        factoryName = "falcon_k1";
    }
}

// Factory: ECDSA R1 + FALCON
contract FALCON_ECDSAr1_Factory is FactoryDeployer {
    constructor() {
        saltLabel = "ZKNOX_FALCON_R1_FACTORY_V0_0_1";
        preQuantumKey = "ecdsa_r1";
        postQuantumKey = "falcon";
        factoryName = "falcon_r1";
    }
}

// Factory: ECDSA K1 + ETHFALCON
contract ETHFALCON_ECDSAk1_Factory is FactoryDeployer {
    constructor() {
        saltLabel = "ZKNOX_ETHFALCON_K1_FACTORY_V0_0_1";
        preQuantumKey = "ecdsa_k1";
        postQuantumKey = "ethfalcon";
        factoryName = "ethfalcon_k1";
    }
}

// Factory: ECDSA R1 + ETHFALCON
contract ETHFALCON_ECDSAr1_Factory is FactoryDeployer {
    constructor() {
        saltLabel = "ZKNOX_ETHFALCON_R1_FACTORY_V0_0_1";
        preQuantumKey = "ecdsa_r1";
        postQuantumKey = "ethfalcon";
        factoryName = "ethfalcon_r1";
    }
}