/**
 * Low-level Ledger APDU transport for ECDSA + ML-DSA commands.
 *
 * Firmware handlers:
 *   GET_MLDSA_SEED    (0x14)  → derive seed on secure element
 *   KEYGEN_DILITHIUM  (0x0c)  → generate keypair from stored seed
 *   SIGN_DILITHIUM    (0x0f)  → init / absorb / finalize signing
 *   GET_SIG_CHUNK     (0x12)  → retrieve signature chunks
 *   GET_PK_CHUNK      (0x13)  → retrieve public key chunks
 *   GET_PUBLIC_KEY    (0x05)  → ECDSA public key
 *   ECDSA_SIGN_HASH   (0x15)  → blind-sign hash with ECDSA
 *   HYBRID_SIGN_HASH  (0x16)  → single-confirm hybrid blind-sign
 *   HYBRID_SIGN_USEROP(0x17)  → clear-sign ERC-4337 UserOp
 */

import TransportWebHID from "@ledgerhq/hw-transport-webhid";
import { ethers } from 'ethers';

const CLA = 0xe0;

const INS = {
    GET_MLDSA_SEED:     0x14,
    KEYGEN_DILITHIUM:   0x0c,
    SIGN_DILITHIUM:     0x0f,
    GET_SIG_CHUNK:      0x12,
    GET_PK_CHUNK:       0x13,
    GET_PUBLIC_KEY:     0x05,
    ECDSA_SIGN_HASH:    0x15,
    HYBRID_SIGN_HASH:   0x16,
    HYBRID_SIGN_USEROP: 0x17,
};

export const MLDSA44_SIG_BYTES = 2420;
export const MLDSA44_PK_BYTES  = 1312;
const CHUNK_SIZE = 255;

// ─── Helpers ────────────────────────────────────────────────────────────

function encodeBip32Path(path) {
    const components = path
        .replace("m/", "")
        .split("/")
        .map(c => {
            const hardened = c.endsWith("'");
            const val = parseInt(hardened ? c.slice(0, -1) : c, 10);
            return hardened ? (val + 0x80000000) >>> 0 : val;
        });

    const buf = Buffer.alloc(1 + components.length * 4);
    buf[0] = components.length;
    components.forEach((c, i) => buf.writeUInt32BE(c, 1 + i * 4));
    return buf;
}

async function sendApdu(transport, ins, p1, p2, data) {
    const payload  = data ? Buffer.from(data) : Buffer.alloc(0);
    const response = await transport.send(CLA, ins, p1, p2, payload);
    return response.subarray(0, response.length - 2);
}

async function readChunked(transport, ins, totalBytes) {
    const buf = Buffer.alloc(totalBytes);
    for (let p1 = 0; p1 * CHUNK_SIZE < totalBytes; p1++) {
        const offset    = p1 * CHUNK_SIZE;
        const remaining = totalBytes - offset;
        const p2        = Math.min(remaining, CHUNK_SIZE);
        const chunk     = await sendApdu(transport, ins, p1, p2, null);
        chunk.copy(buf, offset, 0, p2);
    }
    return new Uint8Array(buf);
}

function bigintTo32BE(val) {
    const hex = BigInt(val).toString(16).padStart(64, '0');
    return Buffer.from(hex, 'hex');
}

function addressToBytes(addr) {
    return Buffer.from(addr.replace(/^0x/, ''), 'hex');
}

/**
 * Parse an ECDSA DER response from the device into { v, r, s }.
 * Response layout: sig_len(1) | DER(r,s) | v(1)
 */
function parseEcdsaResponse(resp) {
    const derLen = resp[0];
    const der    = resp.subarray(1, 1 + derLen);
    const v      = resp[1 + derLen];

    // DER: 30 <len> 02 <rlen> <r> 02 <slen> <s>
    let offset = 2; // skip 30 <len>
    offset++;       // skip 02
    const rLen = der[offset++];
    const rRaw = der.subarray(offset, offset + rLen);
    offset += rLen;
    offset++;       // skip 02
    const sLen = der[offset++];
    const sRaw = der.subarray(offset, offset + sLen);

    // Pad/trim to 32 bytes
    const r = new Uint8Array(32);
    const s = new Uint8Array(32);
    r.set(rRaw.subarray(rRaw.length - 32));
    s.set(sRaw.subarray(sRaw.length - 32));

    return { v, r, s };
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function openTransport() {
    return TransportWebHID.create();
}

/**
 * Derive the ML-DSA seed on the secure element for the given BIP32 path.
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
    await sendApdu(transport, INS.KEYGEN_DILITHIUM, 0x00, 0x00, null);
    return readChunked(transport, INS.GET_PK_CHUNK, MLDSA44_PK_BYTES);
}

/**
 * Sign arbitrary bytes with ML-DSA-44 on the Ledger.
 * Flow: init → absorb (chunked) → finalize → read signature.
 */
export async function signMldsa(transport, messageBytes) {
    await sendApdu(transport, INS.SIGN_DILITHIUM, 0x00, 0x00, null);

    const MAX_APDU_DATA = 250;
    for (let offset = 0; offset < messageBytes.length; offset += MAX_APDU_DATA) {
        const chunk = messageBytes.slice(offset, Math.min(offset + MAX_APDU_DATA, messageBytes.length));
        await sendApdu(transport, INS.SIGN_DILITHIUM, 0x01, 0x00, chunk);
    }

    const msgLenBuf = Buffer.alloc(2);
    msgLenBuf.writeUInt16BE(messageBytes.length, 0);
    await sendApdu(transport, INS.SIGN_DILITHIUM, 0x80, 0x00, msgLenBuf);

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
 */
export async function signEcdsaHash(transport, bip32Path, hash) {
    if (hash.length !== 32) throw new Error("Hash must be 32 bytes");

    const pathData = encodeBip32Path(bip32Path);
    const payload  = Buffer.concat([pathData, Buffer.from(hash)]);
    const resp     = await sendApdu(transport, INS.ECDSA_SIGN_HASH, 0x00, 0x00, payload);

    return parseEcdsaResponse(resp);
}

/**
 * Hybrid blind-sign: single user confirmation → ECDSA + ML-DSA signatures.
 */
export async function signHybridHash(transport, bip32Path, hash) {
    if (hash.length !== 32) throw new Error("Hash must be 32 bytes");

    const pathData = encodeBip32Path(bip32Path);
    const payload  = Buffer.concat([pathData, Buffer.from(hash)]);
    const resp     = await sendApdu(transport, INS.HYBRID_SIGN_HASH, 0x00, 0x00, payload);

    const { v, r, s }   = parseEcdsaResponse(resp);
    const mldsaSignature = await readChunked(transport, INS.GET_SIG_CHUNK, MLDSA44_SIG_BYTES);

    return { ecdsaV: v, ecdsaR: r, ecdsaS: s, mldsaSignature };
}

/**
 * Hybrid clear-sign an ERC-4337 v0.7 UserOperation.
 *
 * Sends four APDUs so the device can recompute the UserOpHash on-chip
 * and display human-readable fields before signing with both algorithms.
 */
export async function signHybridUserOp(transport, bip32Path, userOp, entryPoint, chainId) {
    const I = INS.HYBRID_SIGN_USEROP;

    // APDU 1: BIP32 path
    await sendApdu(transport, I, 0x00, 0x00, encodeBip32Path(bip32Path));

    // APDU 2: chain_id(32) | entry_point(20) | sender(20) | nonce(32)
    await sendApdu(transport, I, 0x01, 0x00, Buffer.concat([
        bigintTo32BE(chainId),
        addressToBytes(entryPoint),
        addressToBytes(userOp.sender),
        bigintTo32BE(userOp.nonce),
    ]));

    // APDU 3: six 32-byte packed fields
    await sendApdu(transport, I, 0x02, 0x00, Buffer.concat([
        ethers.getBytes(ethers.keccak256(userOp.initCode)),
        ethers.getBytes(ethers.keccak256(userOp.callData)),
        ethers.getBytes(userOp.accountGasLimits),
        bigintTo32BE(userOp.preVerificationGas),
        ethers.getBytes(userOp.gasFees),
        ethers.getBytes(ethers.keccak256(userOp.paymasterAndData)),
    ]));

    // APDU 4: raw callData (triggers NBGL review on device)
    const rawCallData = ethers.getBytes(userOp.callData);
    const callDataPayload = rawCallData.length <= CHUNK_SIZE
        ? Buffer.from(rawCallData)
        : Buffer.alloc(0);

    const resp = await sendApdu(transport, I, 0x03, 0x00, callDataPayload);

    const { v, r, s }   = parseEcdsaResponse(resp);
    const mldsaSignature = await readChunked(transport, INS.GET_SIG_CHUNK, MLDSA44_SIG_BYTES);

    return { ecdsaV: v, ecdsaR: r, ecdsaS: s, mldsaSignature };
}
