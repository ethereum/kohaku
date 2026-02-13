import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';

function hexToU8(hex) {
    if (hex.startsWith("0x")) hex = hex.slice(2);
    return Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

export async function getPublicKey(config) {
    const { publicKey } = ml_dsa44.keygen(hexToU8(config.postQuantumSeed));
    console.log("✅ ML-DSA public key generated (" + publicKey.length + " bytes)");
    return publicKey;
}