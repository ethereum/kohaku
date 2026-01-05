// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ZKNOX_AccountFactory} from "../src/ZKNOX_AccountFactory.sol";

contract DeployFactory is Script {
    // EntryPoint v0.7 canonical address
    address constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    
    // Salt label for deterministic deployment
    string constant SALT_LABEL = "ZKNOX_ERC4337_FACTORY_V1";

    function run() external {
        string memory json = vm.readFile("deployments/deployments.json");
        
        // Get network name from chainId
        string memory network;
        if (block.chainid == 11155111) {
            network = "sepolia";
        } else if (block.chainid == 1) {
            network = "mainnet";
        } else {
            revert("Unsupported chain");
        }

        // Read addresses from JSON
        string memory basePath = string.concat(".", network);
        
        address mldsa = vm.parseJsonAddress(json, string.concat(basePath, ".verifiers.mldsa.address"));
        address ecdsaK1 = vm.parseJsonAddress(json, string.concat(basePath, ".verifiers.ecdsak1.address"));
        address hybrid = vm.parseJsonAddress(json, string.concat(basePath, ".hybrid.address"));

        // Compute salt from label
        bytes32 salt = keccak256(abi.encodePacked(SALT_LABEL));

        console.log("Deploying ZKNOX_AccountFactory on", network);
        console.log("  Salt label:", SALT_LABEL);
        console.log("  Salt:", vm.toString(salt));
        console.log("  EntryPoint:", ENTRYPOINT_V07);
        console.log("  PreQuantum (ECDSA K1):", ecdsaK1);
        console.log("  PostQuantum (MLDSA):", mldsa);
        console.log("  Hybrid Verifier:", hybrid);

        vm.startBroadcast();

        ZKNOX_AccountFactory factory = new ZKNOX_AccountFactory{salt: salt}(
            IEntryPoint(ENTRYPOINT_V07),
            ecdsaK1,    // preQuantumLogic
            mldsa,      // postQuantumLogic
            hybrid      // hybridVerifierLogic
        );

        vm.stopBroadcast();

        console.log("Factory deployed at:", address(factory));

        // Update JSON with factory deployment info
        string memory outputJson = vm.serializeAddress("account", "address", address(factory));
        outputJson = vm.serializeBytes32("account", "salt", salt);
        outputJson = vm.serializeString("account", "saltLabel", SALT_LABEL);

        // Write updated account object to the network's account field
        vm.writeJson(outputJson, "deployments/deployments.json", string.concat(basePath, ".account"));
        
        console.log("Updated deployments.json");
    }
}