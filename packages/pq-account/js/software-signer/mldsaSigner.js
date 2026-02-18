import { ml_dsa44 } from '@noble/post-quantum/ml-dsa';
import { hexToU8 } from '../utils.js';

let _secretKey = null;
let _publicKey = null;

export async function init(config) {
    const kp = ml_dsa44.keygen(hexToU8(config.postQuantumSeed));
    _secretKey = kp.secretKey;
    _publicKey = kp.publicKey;
}

export async function sign(messageBytes) {
    if (!_secretKey) throw new Error("Signer not initialized — call init() first");
    // return ml_dsa44.sign(messageBytes, _secretKey, { extraEntropy: false });
    return ml_dsa44.sign(_secretKey, messageBytes);
}

export function getPublicKey() {
    if (!_publicKey) throw new Error("Signer not initialized — call init() first");
    return _publicKey;
}

export async function cleanup() {
    _secretKey = null;
    _publicKey = null;
}
