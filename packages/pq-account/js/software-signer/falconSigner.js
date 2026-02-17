import FalconModule from '../falconESM.js';

const PK_LEN = 1025;
const SK_LEN = 1281;
const SIG_MAX_LEN = 1067;

let _falcon = null;
let _skPtr = null;
let _pkPtr = null;

function hexToU8(hex) {
    if (hex.startsWith("0x")) hex = hex.slice(2);
    return Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

function readUint64(falcon, ptr) {
    const low = falcon.HEAPU32[ptr >> 2];
    const high = falcon.HEAPU32[(ptr >> 2) + 1];
    return BigInt(high) << 32n | BigInt(low);
}

/**
 * Initialise the signer: load WASM module and derive keypair from seed.
 * Matches mldsaSigner.init(config).
 *
 * @param {{ postQuantumSeed: string }} config
 */
export async function init(config) {
    _falcon = await FalconModule();
    const seed = hexToU8(config.postQuantumSeed);

    _pkPtr = _falcon._malloc(PK_LEN);
    _skPtr = _falcon._malloc(SK_LEN);
    const seedPtr = _falcon._malloc(seed.length);
    _falcon.HEAPU8.set(seed, seedPtr);

    const ret = _falcon._zknox_crypto_sign_keypair_from_seed(
        _pkPtr, _skPtr, seedPtr, seed.length
    );
    _falcon._free(seedPtr);

    if (ret !== 0) {
        await cleanup();
        throw new Error("Falcon-512 keygen failed (code " + ret + ")");
    }

    console.log("✅ Falcon-512 signer initialised");
}

/**
 * Sign an arbitrary message (typically a 32-byte UserOp hash).
 * Returns the **detached** signature (signed-message minus the trailing
 * original message), matching the interface of mldsaSigner.sign().
 *
 * @param {Uint8Array} messageBytes
 * @returns {Promise<Uint8Array>} detached Falcon-512 signature
 */
export async function sign(messageBytes) {
    if (!_falcon || !_skPtr) {
        throw new Error("Signer not initialised — call init() first");
    }

    const msg = messageBytes instanceof Uint8Array
        ? messageBytes
        : new Uint8Array(messageBytes);

    const msgPtr = _falcon._malloc(msg.length);
    _falcon.HEAPU8.set(msg, msgPtr);

    const signedMsgMaxLen = 2 + 40 + msg.length + SIG_MAX_LEN;
    const signedMsgPtr = _falcon._malloc(signedMsgMaxLen);
    const signedMsgLenPtr = _falcon._malloc(8);

    try {
        const ret = _falcon._zknox_crypto_sign(
            signedMsgPtr,
            signedMsgLenPtr,
            msgPtr,
            BigInt(msg.length),
            _skPtr
        );
        if (ret !== 0) {
            throw new Error("Falcon-512 signing failed (code " + ret + ")");
        }

        const totalLen = Number(readUint64(_falcon, signedMsgLenPtr));
        // signed-message = sig_header(2) || nonce(40) || sig_body || original_msg
        const sigOnlyLen = totalLen - msg.length;
        const signature = new Uint8Array(
            _falcon.HEAPU8.subarray(signedMsgPtr, signedMsgPtr + sigOnlyLen)
        );
        return signature;

    } finally {
        [msgPtr, signedMsgPtr, signedMsgLenPtr].forEach(p => _falcon._free(p));
    }
}

/**
 * Return the cached public key.
 * @returns {Uint8Array} 1025-byte Falcon-512 public key
 */
export function getPublicKey() {
    if (!_falcon || !_pkPtr) {
        throw new Error("Signer not initialised — call init() first");
    }
    return new Uint8Array(_falcon.HEAPU8.subarray(_pkPtr, _pkPtr + PK_LEN));
}

/**
 * Free WASM heap allocations.
 */
export async function cleanup() {
    if (_falcon) {
        if (_skPtr) { _falcon._free(_skPtr); _skPtr = null; }
        if (_pkPtr) { _falcon._free(_pkPtr); _pkPtr = null; }
    }
    _falcon = null;
}
