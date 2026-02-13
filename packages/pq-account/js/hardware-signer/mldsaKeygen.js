import {
    openTransport,
    deriveMldsaSeed,
    getMldsaPublicKey,
} from './ledgerTransport.js';

const DEFAULT_BIP32_PATH = "m/44'/60'/0'/0/0";

export async function getPublicKey(config = {}) {
    const bip32Path = config.bip32Path || DEFAULT_BIP32_PATH;

    const transport = await openTransport();

    try {
        await deriveMldsaSeed(transport, bip32Path);
        const publicKey = await getMldsaPublicKey(transport);
        console.log("✅ ML-DSA public key retrieved (" + publicKey.length + " bytes)");
        return publicKey;
    } finally {
        await transport.close();
    }
}