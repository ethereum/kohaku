pragma solidity ^0.8.25;

import {console} from "forge-std/Test.sol";

import {BaseScript} from "ETHDILITHIUM/script/BaseScript.sol";
import {ZKNOX_dilithium} from "ETHDILITHIUM/src/ZKNOX_dilithium.sol";
import {ZKNOX_ethdilithium} from "ETHDILITHIUM/src/ZKNOX_ethdilithium.sol";

import {ZKNOX_ecdsa} from "ETHDILITHIUM/src/ZKNOX_ECDSA.sol";

import {ZKNOX_falcon} from "ETHFALCON/src/ZKNOX_falcon.sol";
import {ZKNOX_ethfalcon} from "ETHFALCON/src/ZKNOX_ethfalcon.sol";

import {ZKNOX_HybridVerifier} from "../src/ZKNOX_hybrid.sol";

contract HybridVerifierFixedContract is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        uint256 chainId = block.chainid;
        console.log(chainId);
        if (chainId == 11155111) {
            return address(0x78E229b83378DF8A9AC1164156b542eBbDE2a1D5);
        } else if (chainId == 421614) {
            return address(0x48237092dFe6387B1d7D2AacDA42bc43EdA44aEa);
        } else {
            vm.startBroadcast();
            ZKNOX_HybridVerifier hybridVerifier = new ZKNOX_HybridVerifier();
            console.log("hybridVerifier deployed at:", address(hybridVerifier));
            vm.stopBroadcast();
            return address(hybridVerifier);
        }
    }
}


contract MLDSAFixedContract is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        uint256 chainId = block.chainid;
        if (chainId == 11155111) {
            return address(0xc15278300d4736C10c465E0f73b2D9eCC1c0d94B);
        } else if (chainId == 421614) {
            return address(0xbfF3cd81fDf061D002A91dE3cD589E814AfdC94a);
        } else {
            vm.startBroadcast();
            ZKNOX_dilithium dilithium = new ZKNOX_dilithium();
            console.log("Address of the contract", address(dilithium));
            vm.stopBroadcast();
            return address(dilithium);
        }
    }
}

contract MLDSAETHFixedContract is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        uint256 chainId = block.chainid;
        if (chainId == 11155111) {
            return address(0xa3B09eF2A08f5EF5EB1C091d41a47A39eCB87433);
        } else if (chainId == 421614) {
            return address(0x238045D114024576bf75700aa0eCFEfb47EF764F);
        } else {
            vm.startBroadcast();
            ZKNOX_ethdilithium ethDilithium = new ZKNOX_ethdilithium();
            console.log("Address of the contract", address(ethDilithium));
            vm.stopBroadcast();
            return address(ethDilithium);
        }
    }
}

contract FALCONFixedContract is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        uint256 chainId = block.chainid;
        if (chainId == 11155111) {
            return address(0x8f44FC27b333F0064f13a8c5e3451d4f65D75E60);
        } else if (chainId == 421614) {
            return address(0x5Ce696b0F838C70A64be9D3Ee9017f35A4CBb091);
        } else {
            vm.startBroadcast();
            ZKNOX_falcon falcon = new ZKNOX_falcon();
            console.log("Address of the contract", address(falcon));
            vm.stopBroadcast();
            return address(falcon);
        }
    }
}

contract ETHFALCONFixedContract is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        uint256 chainId = block.chainid;
        if (chainId == 11155111) {
            return address(0x544F59a8Adb31818bfcFEA4759DD8495aFF2E30f);
        } else if (chainId == 421614) {
            return address(0x8B210Cd6E66a5d6EABD50cefE8Ef66A0e5b3e7a2);
        } else {
            vm.startBroadcast();
            ZKNOX_ethfalcon ethFalcon = new ZKNOX_ethfalcon();
            console.log("Address of the contract", address(ethFalcon));
            vm.stopBroadcast();
            return address(ethFalcon);
        }
    }
}

contract ECDSAK1FixedContract is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        uint256 chainId = block.chainid;
        if (chainId == 11155111) {
            return address(0x70b7bB1CD374768Af0d2Ad76aB7EBD0Aca4b54d6);
        } else if (chainId == 421614) {
            return address(0x51dD569c0A1be3Ed093992dc8745cf324d203bb5);
        } else {
            vm.startBroadcast();
            ZKNOX_ecdsa ecdsa = new ZKNOX_ecdsa();
            vm.stopBroadcast();
            return address(ecdsa);
        }
    }
}

