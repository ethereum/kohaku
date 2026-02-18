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
 * Pack 512 NTT coefficients (each 16 bits) into 32 uint256 words,
 * matching _ZKNOX_NTT_Compact in Solidity.
 *
 * Coefficients are stored as unsigned 16-bit values (two's complement
 * for signed s2 values).
 *
 * @param {number[]} coeffs - 512 coefficients (unsigned 16-bit)
 * @returns {BigInt[]} 32 packed uint256 words
 */
function nttCompact(coeffs) {
    if (coeffs.length !== 512) throw new Error("Expected 512 coefficients, got " + coeffs.length);

    const b = new Array(32).fill(0n);

    for (let i = 0; i < 512; i++) {
        const wordIndex = i >> 4;           // i / 16
        const bitShift = (i & 0xf) * 16;   // (i % 16) * 16
        b[wordIndex] ^= BigInt(coeffs[i] & 0xFFFF) << BigInt(bitShift);
    }

    return b;
}

/**
 * Extract nonce and s2 from the raw WASM signed-message output,
 * then return nonce(40) || nttCompact(s2)(1024).
 *
 * WASM signed-message layout (from C code):
 *   sig_len   (2 bytes, BE)
 *   nonce     (40 bytes)
 *   message   (mlen bytes)
 *   esig      (1 byte header + 512 × 16-bit encoded s2)
 *
 * @param {Uint8Array} sm       - full signed-message buffer from WASM
 * @param {number}     totalLen - total length written by WASM
 * @param {number}     msgLen   - length of the original message
 * @returns {Uint8Array} 1064-byte packed signature: nonce(40) + packed_s2(1024)
 */
function compactifySignature(sm, totalLen, msgLen) {
    // Debug: verify the signed-message layout
    const sigLen = (sm[0] << 8) | sm[1];
    console.log("🔍 Debug compactifySignature:");
    console.log("  totalLen=" + totalLen + ", msgLen=" + msgLen + ", sigLen(from header)=" + sigLen);
    console.log("  expected totalLen=" + (2 + 40 + msgLen + sigLen));

    // Extract 40-byte nonce (after 2-byte sig_len header)
    const nonce = sm.subarray(2, 42);

    // esig starts after sig_len(2) + nonce(40) + message(msgLen)
    const esigOffset = 2 + 40 + msgLen;
    const esig = sm.subarray(esigOffset, totalLen);
    console.log("  esigOffset=" + esigOffset + ", esig.length=" + esig.length);
    console.log("  esig header byte: 0x" + esig[0].toString(16) + " (expected 0x29)");
    console.log("  first 3 s2 coeffs (BE): " +
        [0,1,2].map(i => ((esig[1+i*2] << 8) | esig[1+i*2+1])).join(", "));

    // esig[0] = header byte (0x20 + 9 = 0x29), skip it
    // esig[1..] = 512 × 16-bit encoded s2 coefficients
    if (esig[0] !== 0x29) {
        console.warn("Unexpected esig header: 0x" + esig[0].toString(16) + " (expected 0x29)");
    }

    const s2Coeffs = [];
    for (let i = 0; i < 512; i++) {
        const offset = 1 + i * 2;
        // Big-endian 16-bit read (matching WASM modq_encode16 / comp_encode16)
        s2Coeffs.push((esig[offset] << 8) | esig[offset + 1]);
    }

    // Pack into 32 uint256 words
    const packed = nttCompact(s2Coeffs);

    // Build result: nonce(40) || packed_s2(1024)
    const result = new Uint8Array(40 + 1024);
    result.set(nonce, 0);

    for (let i = 0; i < 32; i++) {
        const word = packed[i];
        for (let j = 0; j < 32; j++) {
            // Big-endian: MSB first within each uint256 word
            result[40 + i * 32 + (31 - j)] = Number((word >> BigInt(j * 8)) & 0xFFn);
        }
    }

    return result;
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
 * Returns the compacted detached signature: nonce(40) || nttCompact(s2)(1024),
 * matching the on-chain verifier's expected format.
 *
 * @param {Uint8Array} messageBytes
 * @returns {Promise<Uint8Array>} 1064-byte compacted Falcon-512 signature
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

        // Copy the full signed-message buffer
        const sm = new Uint8Array(
            _falcon.HEAPU8.subarray(signedMsgPtr, signedMsgPtr + totalLen)
        );

        // Debug: dump raw signed-message hex (first 100 bytes + last 20)
        const smHex = Array.from(sm).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log("🔍 Raw signed-message (" + totalLen + " bytes):");
        console.log("  first 100 bytes: " + smHex.slice(0, 200));
        console.log("  last 20 bytes:   " + smHex.slice(-40));

        // ── Round-trip test: verify raw signature via WASM ──
        console.log("🔍 Round-trip test: verifying raw signature via WASM...");
        {
            const smVerifyPtr = _falcon._malloc(totalLen);
            const mOutPtr = _falcon._malloc(msg.length + 100);
            const mOutLenPtr = _falcon._malloc(8);
            _falcon.HEAPU8.set(sm, smVerifyPtr);

            const vret = _falcon._zknox_crypto_sign_open(
                mOutPtr, mOutLenPtr, smVerifyPtr, BigInt(totalLen), _pkPtr
            );
            console.log("  WASM verify result: " + (vret === 0 ? "✅ VALID" : "❌ FAILED (code " + vret + ")"));

            [smVerifyPtr, mOutPtr, mOutLenPtr].forEach(p => _falcon._free(p));
        }

        // ── Round-trip test 2: reconstruct signed-message from compacted data ──
        console.log("🔍 Round-trip test 2: reconstruct from compacted → verify...");
        {
            const compacted = compactifySignature(sm, totalLen, msg.length);
            const nonce = compacted.subarray(0, 40);
            const packedS2 = compacted.subarray(40);

            // Unpack s2 coefficients from nttCompact format
            const s2Reconstructed = [];
            for (let i = 0; i < 512; i++) {
                const wordIndex = i >> 4;
                const bitPos = (i & 0xf) * 16;
                const byteStart = 40 + wordIndex * 32;
                // Read the uint256 word back (big-endian)
                let word = 0n;
                for (let j = 0; j < 32; j++) {
                    word = (word << 8n) | BigInt(compacted[byteStart + j]);
                }
                const coeff = Number((word >> BigInt(bitPos)) & 0xFFFFn);
                s2Reconstructed.push(coeff);
            }

            // Re-encode s2 as big-endian bytes (same as comp_encode16)
            const esigRecon = new Uint8Array(1 + 1024);
            esigRecon[0] = 0x29; // header
            for (let i = 0; i < 512; i++) {
                esigRecon[1 + i * 2] = (s2Reconstructed[i] >> 8) & 0xFF;
                esigRecon[1 + i * 2 + 1] = s2Reconstructed[i] & 0xFF;
            }

            // Compare first 20 esig bytes with original
            const esigOriginal = sm.subarray(2 + 40 + msg.length, totalLen);
            const match = esigRecon.every((b, i) => b === esigOriginal[i]);
            console.log("  esig reconstruction matches original: " + (match ? "✅ YES" : "❌ NO"));

            if (!match) {
                const origHex = Array.from(esigOriginal.subarray(0, 20)).map(b => b.toString(16).padStart(2, '0')).join('');
                const reconHex = Array.from(esigRecon.subarray(0, 20)).map(b => b.toString(16).padStart(2, '0')).join('');
                console.log("  original esig (first 20): " + origHex);
                console.log("  reconstructed (first 20): " + reconHex);
            }

            // Rebuild full signed-message and verify via WASM
            const sigLen = 1025;
            const reconSm = new Uint8Array(2 + 40 + msg.length + sigLen);
            reconSm[0] = (sigLen >> 8) & 0xFF;
            reconSm[1] = sigLen & 0xFF;
            reconSm.set(nonce, 2);
            reconSm.set(msg, 42);
            reconSm.set(esigRecon, 42 + msg.length);

            const smPtr2 = _falcon._malloc(reconSm.length);
            const mPtr2 = _falcon._malloc(msg.length + 100);
            const mLenPtr2 = _falcon._malloc(8);
            _falcon.HEAPU8.set(reconSm, smPtr2);

            const vret2 = _falcon._zknox_crypto_sign_open(
                mPtr2, mLenPtr2, smPtr2, BigInt(reconSm.length), _pkPtr
            );
            console.log("  Reconstructed verify result: " + (vret2 === 0 ? "✅ VALID" : "❌ FAILED (code " + vret2 + ")"));

            [smPtr2, mPtr2, mLenPtr2].forEach(p => _falcon._free(p));
        }

        // Compactify: extract nonce + s2 from correct positions → nttCompact
        const compacted = compactifySignature(sm, totalLen, msg.length);

        // Debug: dump compacted signature
        const compHex = Array.from(compacted).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log("🔍 Compacted signature (" + compacted.length + " bytes):");
        console.log("  nonce (40 bytes): " + compHex.slice(0, 80));
        console.log("  packed_s2 first 64 bytes: " + compHex.slice(80, 80 + 128));
        console.log("🔍 FULL PQ SIG HEX: 0x" + compHex);

        return compacted;

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
