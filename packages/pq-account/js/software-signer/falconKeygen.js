import FalconModule from '../falconESM.js';

const PK_LEN = 1025;
const SK_LEN = 1281;

function hexToU8(hex) {
    if (hex.startsWith("0x")) hex = hex.slice(2);
    return Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

/**
 * Derive a Falcon-512 public key from a 32-byte hex seed.
 * Matches the interface of mldsaKeygen.getPublicKey(config).
 *
 * @param {{ postQuantumSeed: string }} config
 * @returns {Promise<Uint8Array>} 1025-byte public key
 */
export async function getPublicKey(config) {
    const falcon = await FalconModule();
    const seed = hexToU8(config.postQuantumSeed);

    const pkPtr = falcon._malloc(PK_LEN);
    const skPtr = falcon._malloc(SK_LEN);
    const seedPtr = falcon._malloc(seed.length);
    falcon.HEAPU8.set(seed, seedPtr);

    try {
        const ret = falcon._zknox_crypto_sign_keypair_from_seed(
            pkPtr, skPtr, seedPtr, seed.length
        );
        if (ret !== 0) {
            throw new Error("Falcon-512 keygen failed (code " + ret + ")");
        }

        const publicKey = new Uint8Array(
            falcon.HEAPU8.subarray(pkPtr, pkPtr + PK_LEN)
        );
        console.log("✅ Falcon-512 public key generated (" + publicKey.length + " bytes)");
        return publicKey;

    } finally {
        [pkPtr, skPtr, seedPtr].forEach(p => falcon._free(p));
    }
}
