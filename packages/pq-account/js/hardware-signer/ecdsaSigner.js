import {
    openTransport,
    getEcdsaPublicKey,
    signEcdsaHash,
} from './ledgerTransport.js';
import { keccak256, ethers } from 'ethers';

const DEFAULT_BIP32_PATH = "m/44'/60'/0'/0/0";
let _transport = null;
let _address = null;

export async function init(config = {}) {
    const bip32Path = config.bip32Path || DEFAULT_BIP32_PATH;
    if (!_transport) {
        _transport = await openTransport();
    }
    const pubkey = await getEcdsaPublicKey(_transport, bip32Path);
    // Response: length(1) + 04(1) + x(32) + y(32) + [chain_code(32)]
    // Skip first 2 bytes, take next 64 bytes (x || y)
    const raw = pubkey.subarray(2, 66);
    const hash = keccak256(raw);
    _address = "0x" + hash.slice(-40);
}
export function getAddress() {
    if (!_address) throw new Error("Signer not initialized — call init() first");
    return _address;
}

export async function signHash(hash) {
    if (!_transport) throw new Error("Signer not initialized — call init() first");
    const { v, r, s } = await signEcdsaHash(_transport, DEFAULT_BIP32_PATH, hash);
    // Ledger returns v as 0/1, ethers expects 27/28
    const serialized = ethers.concat([r, s, ethers.toBeHex(v + 27, 1)]);
    return { serialized };
}

export async function cleanup() {
    if (_transport) {
        try { await _transport.close(); } catch (e) {}
        _transport = null;
        _address = null;
    }
}

export function getTransport() {
    return _transport;
}

export function setTransport(t) {
    _transport = t;
}