import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';

let _secretKey = null;
let _publicKey = null;

function hexToU8(hex) {
    if (hex.startsWith("0x")) hex = hex.slice(2);
    return Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

export async function init(config) {
    const seedBytes = hexToU8(config.postQuantumSeed);
    const kp = ml_dsa44.keygen(seedBytes);
    _secretKey = kp.secretKey;
    _publicKey = kp.publicKey;
}

export async function sign(messageBytes) {
    if (!_secretKey) throw new Error("Signer not initialized — call init() first");
    return ml_dsa44.sign(messageBytes, _secretKey, {extraEntropy: false});
}

export function getPublicKey() {
    if (!_publicKey) throw new Error("Signer not initialized — call init() first");
    return _publicKey;
}

export async function cleanup() {
    _secretKey = null;
    _publicKey = null;
}