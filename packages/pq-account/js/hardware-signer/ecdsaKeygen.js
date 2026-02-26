import { ethers } from 'ethers';
import { openTransport, getEcdsaPublicKey } from './ledgerTransport.js';

const DEFAULT_BIP32_PATH = "m/44'/60'/0'/0/0";

export async function getAddress(config = {}) {
    const bip32Path = config.bip32Path || DEFAULT_BIP32_PATH;
    const transport = await openTransport();

    try {
        const pubkey  = await getEcdsaPublicKey(transport, bip32Path);
        const raw     = pubkey.subarray(2, 66);
        const hash    = ethers.keccak256(raw);
        const address = "0x" + hash.slice(-40);
        console.log("✅ ECDSA address: " + address);
        return address;
    } finally {
        await transport.close();
    }
}
