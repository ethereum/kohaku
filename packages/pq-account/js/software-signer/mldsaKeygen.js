import { ml_dsa44 } from '@noble/post-quantum/ml-dsa';
import { hexToU8 } from '../utils.js';

export async function getPublicKey(config) {
    const { publicKey } = ml_dsa44.keygen(hexToU8(config.postQuantumSeed));
    console.log("✅ ML-DSA public key generated (" + publicKey.length + " bytes)");
    return publicKey;
}
