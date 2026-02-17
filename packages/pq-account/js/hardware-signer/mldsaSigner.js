import {
    openTransport,
    deriveMldsaSeed,
    signMldsa,
    getMldsaPublicKey,
} from './ledgerTransport.js';

const DEFAULT_BIP32_PATH = "m/44'/60'/0'/0/0";
let _transport = null;

export async function init(config = {}) {
    const bip32Path = config.bip32Path || DEFAULT_BIP32_PATH;
    if (!_transport) {
        _transport = await openTransport();
    }
    await deriveMldsaSeed(_transport, bip32Path);
}

export async function sign(messageBytes) {
    if (!_transport) throw new Error("Signer not initialized — call init() first");
    return signMldsa(_transport, messageBytes);
}

export async function getPublicKey() {
    if (!_transport) throw new Error("Signer not initialized — call init() first");
    return getMldsaPublicKey(_transport);
}

export async function cleanup() {
    if (_transport) {
        try { await _transport.close(); } catch (e) {}
        _transport = null;
    }
}

export function getTransport() {
    return _transport;
}

export function setTransport(t) {
    _transport = t;
}