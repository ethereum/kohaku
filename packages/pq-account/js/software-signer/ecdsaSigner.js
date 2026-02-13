import { Wallet } from 'ethers';

let _wallet = null;

/**
 * @param {{ privateKey: string }} config - hex private key
 */
export async function init(config) {
    _wallet = new Wallet(config.privateKey);
}

export function getAddress() {
    if (!_wallet) throw new Error("Signer not initialized — call init() first");
    return _wallet.address;
}

/**
 * Sign a 32-byte hash. Returns { v, r, s }.
 * @param {Uint8Array} hash - 32 bytes
 */
export async function signHash(hash) {
    if (!_wallet) throw new Error("Signer not initialized — call init() first");
    const sig = _wallet.signingKey.sign(hash);
    return { serialized: sig.serialized };
}

export async function cleanup() {
    _wallet = null;
}