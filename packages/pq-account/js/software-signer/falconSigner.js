import FalconModule from '../falconESM.js';
import { hexToU8, nttCompact } from '../utils.js';

const PK_LEN     = 1025;
const SK_LEN     = 1281;
const SIG_MAX_LEN = 1067;

let _falcon = null;
let _skPtr  = null;
let _pkPtr  = null;

function readUint64(falcon, ptr) {
    const low  = falcon.HEAPU32[ptr >> 2];
    const high = falcon.HEAPU32[(ptr >> 2) + 1];
    return BigInt(high) << 32n | BigInt(low);
}

/**
 * Extract nonce and s2 from raw WASM signed-message output,
 * then return nonce(40) || nttCompact(s2)(1024).
 *
 * WASM layout: sig_len(2) | nonce(40) | message(mlen) | esig(1+512×2)
 */
function compactifySignature(sm, totalLen, msgLen) {
    const nonce = sm.subarray(2, 42);

    const esigOffset = 2 + 40 + msgLen;
    const esig = sm.subarray(esigOffset, totalLen);

    if (esig[0] !== 0x29) {
        throw new Error("Unexpected esig header: 0x" + esig[0].toString(16) + " (expected 0x29)");
    }

    const s2Coeffs = [];
    for (let i = 0; i < 512; i++) {
        const offset = 1 + i * 2;
        s2Coeffs.push((esig[offset] << 8) | esig[offset + 1]);
    }

    const packed = nttCompact(s2Coeffs);

    const result = new Uint8Array(40 + 1024);
    result.set(nonce, 0);
    for (let i = 0; i < 32; i++) {
        const word = packed[i];
        for (let j = 0; j < 32; j++) {
            result[40 + i * 32 + (31 - j)] = Number((word >> BigInt(j * 8)) & 0xFFn);
        }
    }
    return result;
}

/**
 * Initialise the signer: load WASM module and derive keypair from seed.
 * @param {{ postQuantumSeed: string }} config
 */
export async function init(config) {
    _falcon = await FalconModule();
    const seed = hexToU8(config.postQuantumSeed);

    _pkPtr = _falcon._malloc(PK_LEN);
    _skPtr = _falcon._malloc(SK_LEN);
    const seedPtr = _falcon._malloc(seed.length);
    _falcon.HEAPU8.set(seed, seedPtr);

    const ret = _falcon._zknox_crypto_sign_keypair_from_seed(_pkPtr, _skPtr, seedPtr, seed.length);
    _falcon._free(seedPtr);

    if (ret !== 0) {
        await cleanup();
        throw new Error("Falcon-512 keygen failed (code " + ret + ")");
    }
}

/**
 * Sign an arbitrary message (typically a 32-byte UserOp hash).
 * Returns the compacted detached signature: nonce(40) || nttCompact(s2)(1024).
 *
 * @param {Uint8Array} messageBytes
 * @returns {Promise<Uint8Array>} 1064-byte compacted Falcon-512 signature
 */
export async function sign(messageBytes) {
    if (!_falcon || !_skPtr) throw new Error("Signer not initialised — call init() first");

    const msg = messageBytes instanceof Uint8Array ? messageBytes : new Uint8Array(messageBytes);

    const msgPtr       = _falcon._malloc(msg.length);
    const smMaxLen     = 2 + 40 + msg.length + SIG_MAX_LEN;
    const smPtr        = _falcon._malloc(smMaxLen);
    const smLenPtr     = _falcon._malloc(8);
    _falcon.HEAPU8.set(msg, msgPtr);

    try {
        const ret = _falcon._zknox_crypto_sign(smPtr, smLenPtr, msgPtr, BigInt(msg.length), _skPtr);
        if (ret !== 0) throw new Error("Falcon-512 signing failed (code " + ret + ")");

        const totalLen = Number(readUint64(_falcon, smLenPtr));
        const sm = new Uint8Array(_falcon.HEAPU8.subarray(smPtr, smPtr + totalLen));
        return compactifySignature(sm, totalLen, msg.length);
    } finally {
        [msgPtr, smPtr, smLenPtr].forEach(p => _falcon._free(p));
    }
}

/**
 * Return the cached public key.
 * @returns {Uint8Array} 1025-byte Falcon-512 public key
 */
export function getPublicKey() {
    if (!_falcon || !_pkPtr) throw new Error("Signer not initialised — call init() first");
    return new Uint8Array(_falcon.HEAPU8.subarray(_pkPtr, _pkPtr + PK_LEN));
}

export async function cleanup() {
    if (_falcon) {
        if (_skPtr) { _falcon._free(_skPtr); _skPtr = null; }
        if (_pkPtr) { _falcon._free(_pkPtr); _pkPtr = null; }
    }
    _falcon = null;
}
