import { Wallet } from 'ethers';

let _wallet = null;

/**
 * @param {{ privateKey: string }} config
 */
export async function init(config) {
    _wallet = new Wallet(config.privateKey);
}

export function getAddress() {
    if (!_wallet) throw new Error("Signer not initialized — call init() first");
    return _wallet.address;
}

/**
 * Sign a 32-byte hash.
 * @param {Uint8Array} hash
 */
export async function signHash(hash) {
    if (!_wallet) throw new Error("Signer not initialized — call init() first");
    return { serialized: _wallet.signingKey.sign(hash).serialized };
}

export async function cleanup() {
    _wallet = null;
}
