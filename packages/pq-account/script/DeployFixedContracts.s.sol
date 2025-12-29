pragma solidity ^0.8.25;

import {console} from "forge-std/Test.sol";

import {BaseScript} from "ETHDILITHIUM/script/BaseScript.sol";
import {ZKNOX_dilithium} from "ETHDILITHIUM/src/ZKNOX_dilithium.sol";
import {ZKNOX_ethdilithium} from "ETHDILITHIUM/src/ZKNOX_ethdilithium.sol";

import {ZKNOX_ecdsa} from "ETHDILITHIUM/src/ZKNOX_ECDSA.sol";

import {ZKNOX_falcon} from "ETHFALCON/src/ZKNOX_falcon.sol";
import {ZKNOX_ethfalcon} from "ETHFALCON/src/ZKNOX_ethfalcon.sol";


import {ZKNOX_HybridVerifier} from "../src/ZKNOX_hybrid.sol";

contract MLDSAFixedContract is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        vm.startBroadcast();
        ZKNOX_dilithium dilithium = new ZKNOX_dilithium();
        console.log("Address of the contract", address(dilithium));
        vm.stopBroadcast();
        return address(dilithium);
    }
}

contract MLDSAETHFixedContract is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        vm.startBroadcast();
        ZKNOX_ethdilithium ethDilithium = new ZKNOX_ethdilithium();
        console.log("Address of the contract", address(ethDilithium));
        vm.stopBroadcast();
        return address(ethDilithium);
    }
}

contract FALCONFixedContract is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        vm.startBroadcast();
        ZKNOX_falcon falcon = new ZKNOX_falcon();
        console.log("Address of the contract", address(falcon));
        vm.stopBroadcast();
        return address(falcon);
    }
}

contract ETHFALCONFixedContract is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        vm.startBroadcast();
        ZKNOX_ethfalcon ethFalcon = new ZKNOX_ethfalcon();
        console.log("Address of the contract", address(ethFalcon));
        vm.stopBroadcast();
        return address(ethFalcon);
    }
}


contract ECDSAK1FixedContract is BaseScript {
    // SPDX-License-Identifier: MIT

    function run() external returns (address) {
        vm.startBroadcast();
        ZKNOX_ecdsa ecdsa = new ZKNOX_ecdsa();
        vm.stopBroadcast();
        return address(ecdsa);
    }
}

