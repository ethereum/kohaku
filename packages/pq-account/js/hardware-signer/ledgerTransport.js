/**
 * Low-level Ledger APDU transport for ML-DSA commands.
 *
 * Maps directly to the firmware handlers in zkn_magicbox.c / dispatcher.c:
 *   GET_MLDSA_SEED (0x14)  → derive seed on secure element
 *   SIGN_DILITHIUM (0x0f)  → init / absorb / finalize signing
 *   GET_SIG_CHUNK  (0x12)  → retrieve signature chunks from g_zknox.sig
 *   GET_PK_CHUNK   (0x13)  → retrieve public key chunks from g_zknox.pk
 *   KEYGEN_DILITHIUM (0x0c) → generate keypair from stored seed
 */

import TransportWebHID from "@ledgerhq/hw-transport-webhid";

// Must match firmware constants.h / types.h
const CLA = 0xe0;

const INS = {
    GET_MLDSA_SEED:   0x14,
    KEYGEN_DILITHIUM: 0x0c,
    SIGN_DILITHIUM:   0x0f,
    GET_SIG_CHUNK:    0x12,
    GET_PK_CHUNK:     0x13,
    GET_PUBLIC_KEY:     0x05,
    ECDSA_SIGN_HASH:   0x15,
};

export const MLDSA44_SIG_BYTES = 2420;
export const MLDSA44_PK_BYTES  = 1312;
const CHUNK_SIZE = 255;  // firmware uses p1 * 255 as offset

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Encode a BIP32 path into Ledger wire format.
 * @param {string} path - e.g. "m/44'/60'/0'/0/0"
 */
function encodeBip32Path(path) {
    const components = path
        .replace("m/", "")
        .split("/")
        .map((c) => {
            const hardened = c.endsWith("'");
            const val = parseInt(hardened ? c.slice(0, -1) : c, 10);
            return hardened ? (val + 0x80000000) >>> 0 : val;
        });

    const buf = Buffer.alloc(1 + components.length * 4);
    buf[0] = components.length;
    components.forEach((c, i) => buf.writeUInt32BE(c, 1 + i * 4));
    return buf;
}

/**
 * Send a single APDU. Strips the 2-byte status word from the response.
 */
async function sendApdu(transport, ins, p1, p2, data) {
    const payload = data ? Buffer.from(data) : Buffer.alloc(0);
    const response = await transport.send(CLA, ins, p1, p2, payload);
    return response.subarray(0, response.length - 2);
}

/**
 * Read a large buffer from the device in CHUNK_SIZE chunks.
 */
async function readChunked(transport, ins, totalBytes) {
    const buf = Buffer.alloc(totalBytes);
    for (let p1 = 0; p1 * CHUNK_SIZE < totalBytes; p1++) {
        const offset = p1 * CHUNK_SIZE;
        const remaining = totalBytes - offset;
        const p2 = Math.min(remaining, CHUNK_SIZE);
        const chunk = await sendApdu(transport, ins, p1, p2, null);
        chunk.copy(buf, offset, 0, p2);
    }
    return new Uint8Array(buf);
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function openTransport() {
    return TransportWebHID.create();
}

/**
 * Derive the ML-DSA seed on the secure element for the given BIP32 path.
 * Stores it in g_zknox.mldsa_seed. Returns the 32-byte seed.
 */
export async function deriveMldsaSeed(transport, bip32Path) {
    const pathData = encodeBip32Path(bip32Path);
    const seed = await sendApdu(transport, INS.GET_MLDSA_SEED, 0x00, 0x00, pathData);
    return new Uint8Array(seed);
}

/**
 * Generate keypair on-device and retrieve the 1312-byte public key.
 */
export async function getMldsaPublicKey(transport) {
    // Keygen from stored seed (must call deriveMldsaSeed first)
    await sendApdu(transport, INS.KEYGEN_DILITHIUM, 0x00, 0x00, null);
    return readChunked(transport, INS.GET_PK_CHUNK, MLDSA44_PK_BYTES);
}

/**
 * Sign arbitrary bytes with ML-DSA-44 on the Ledger.
 *
 * Flow: init → absorb (chunked) → finalize → read signature chunks.
 *
 * @param {Transport}  transport
 * @param {Uint8Array} messageBytes
 * @returns {Promise<Uint8Array>} 2420-byte signature
 */
export async function signMldsa(transport, messageBytes) {
    // 1. Init — derives keypair from g_zknox.mldsa_seed
    await sendApdu(transport, INS.SIGN_DILITHIUM, 0x00, 0x00, null);

    // 2. Absorb message bytes
    const MAX_APDU_DATA = 250;
    for (let offset = 0; offset < messageBytes.length; offset += MAX_APDU_DATA) {
        const end = Math.min(offset + MAX_APDU_DATA, messageBytes.length);
        const chunk = messageBytes.slice(offset, end);
        await sendApdu(transport, INS.SIGN_DILITHIUM, 0x01, 0x00, chunk);
    }

    // 3. Finalize — send 2-byte big-endian message length
    const msgLenBuf = Buffer.alloc(2);
    msgLenBuf.writeUInt16BE(messageBytes.length, 0);
    await sendApdu(transport, INS.SIGN_DILITHIUM, 0x80, 0x00, msgLenBuf);

    // 4. Read full signature
    return readChunked(transport, INS.GET_SIG_CHUNK, MLDSA44_SIG_BYTES);
}


/**
 * Get the ECDSA public key (65 bytes uncompressed) for the given BIP32 path.
 */
export async function getEcdsaPublicKey(transport, bip32Path) {
    const pathData = encodeBip32Path(bip32Path);
    return new Uint8Array(await sendApdu(transport, INS.GET_PUBLIC_KEY, 0x00, 0x00, pathData));
}

/**
 * Blind-sign a 32-byte hash with ECDSA on the Ledger.
 * Returns { v, r, s } with r and s as 32-byte Uint8Arrays.
 */
export async function signEcdsaHash(transport, bip32Path, hash) {
    if (hash.length !== 32) throw new Error("Hash must be 32 bytes");

    const pathData = encodeBip32Path(bip32Path);
    const payload = Buffer.concat([pathData, Buffer.from(hash)]);
    const resp = await sendApdu(transport, INS.ECDSA_SIGN_HASH, 0x00, 0x00, payload);

    // Response: sig_len (1) | DER(r,s) | v (1)
    const derLen = resp[0];
    const der = resp.subarray(1, 1 + derLen);
    const v = resp[1 + derLen];

    // Parse DER: 30 <len> 02 <rlen> <r> 02 <slen> <s>
    let offset = 2; // skip 30 <len>
    offset++; // skip 02
    const rLen = der[offset++];
    const rRaw = der.subarray(offset, offset + rLen);
    offset += rLen;
    offset++; // skip 02
    const sLen = der[offset++];
    const sRaw = der.subarray(offset, offset + sLen);

    // Pad/trim to 32 bytes
    const r = new Uint8Array(32);
    const s = new Uint8Array(32);
    r.set(rRaw.subarray(rRaw.length - 32));
    s.set(sRaw.subarray(sRaw.length - 32));

    return { v, r, s };
}