import { ethers } from 'ethers';
import { shake128, shake256 } from '@noble/hashes/sha3.js';
import { genCrystals } from '@noble/post-quantum/_crystals.js';

const N = 256;
const Q = 8380417;
const D = 13;

const { NTT } = genCrystals({
    N, Q, F: 8347681, ROOT_OF_UNITY: 1753,
    newPoly: (n) => new Int32Array(n),
    isKyber: false, brvBits: 8,
});

function polyShiftl(p) {
    for (let i = 0; i < N; i++) p[i] <<= D;
    return p;
}

function RejectionSamplePoly(rho, i, j, N = 256, q = 8380417) {
    const seed = new Uint8Array(rho.length + 2);
    seed.set(rho, 0);
    seed[rho.length]     = j;
    seed[rho.length + 1] = i;

    const xof = shake128.create();
    xof.update(seed);

    const r = new Int32Array(N);
    let idx = 0;

    while (idx < N) {
        const buf = new Uint8Array(3 * 64);
        xof.xofInto(buf);

        for (let k = 0; idx < N && k <= buf.length - 3; k += 3) {
            let t = buf[k] | (buf[k + 1] << 8) | (buf[k + 2] << 16);
            t &= 0x7fffff;
            if (t < q) r[idx++] = t;
        }
    }
    return r;
}

export function recoverAhat(rho, K, L) {
    const A_hat = [];
    for (let i = 0; i < K; i++) {
        const row = [];
        for (let j = 0; j < L; j++) {
            row.push(RejectionSamplePoly(rho, i, j));
        }
        A_hat.push(row);
    }
    return A_hat;
}

const newPoly = () => new Int32Array(N);

function polyDecode10Bits(bytes) {
    const poly = newPoly();
    let r = 0n;
    for (let i = 0; i < bytes.length; i++) r |= BigInt(bytes[i]) << BigInt(8 * i);

    const mask = (1 << 10) - 1;
    for (let i = 0; i < 256; i++) {
        poly[i] = Number((r >> BigInt(i * 10)) & BigInt(mask));
    }
    return poly;
}

/**
 * Decode ML-DSA-44 public key into { rho, t1, tr }.
 */
export function decodePublicKey(publicKey) {
    const RHO_BYTES    = 32;
    const K            = 4;
    const T1_POLY_BYTES = 320;

    if (publicKey.length !== RHO_BYTES + K * T1_POLY_BYTES)
        throw new Error('Invalid publicKey length');

    const rho = publicKey.slice(0, RHO_BYTES);

    const t1 = [];
    for (let i = 0; i < K; i++) {
        const offset = RHO_BYTES + i * T1_POLY_BYTES;
        t1.push(polyDecode10Bits(publicKey.slice(offset, offset + T1_POLY_BYTES)));
    }

    const tr = shake256(new Uint8Array(publicKey), { dkLen: 64 });
    return { rho, t1, tr };
}

export function compact_module_256(data, m) {
    return data.map(row => row.map(p => compact_poly_256(p, m)));
}

export function compact_poly_256(coeffs, m) {
    if (m >= 256) throw new Error('m must be less than 256');
    if ((coeffs.length * m) % 256 !== 0)
        throw new Error('Total bits must be divisible by 256');

    const a = Array.from(coeffs, x => {
        if (typeof x === 'bigint') return x;
        if (typeof x === 'number') return BigInt(Math.floor(x));
        throw new Error(`Element ${x} cannot be converted to BigInt`);
    });

    for (const elt of a) {
        if (elt >= (1n << BigInt(m)))
            throw new Error(`Element ${elt} too large for ${m} bits`);
    }

    const n = (a.length * m) / 256;
    const b = new Array(n).fill(0n);

    for (let i = 0; i < a.length; i++) {
        const idx   = Math.floor((i * m) / 256);
        const shift = BigInt((i % (256 / m)) * m);
        b[idx] |= a[i] << shift;
    }
    return b;
}

export function to_expanded_encoded_bytes(publicKey) {
    const { rho, t1, tr } = decodePublicKey(publicKey);
    t1.forEach(poly => NTT.encode(polyShiftl(poly)));

    const A_hat = recoverAhat(rho, 4, 4);
    const A_hat_compact = compact_module_256(A_hat, 32);
    const A_hat_stringified = A_hat_compact.map(row =>
        row.map(col => col.map(val => val.toString()))
    );

    const t1_compact = compact_module_256([t1], 32)[0];
    const t1_stringified = t1_compact.map(row =>
        row.map(val => val.toString())
    );

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const aHatEncoded = abiCoder.encode(["uint256[][][]"], [A_hat_stringified]);
    const t1Encoded   = abiCoder.encode(["uint256[][]"], [t1_stringified]);
    return abiCoder.encode(["bytes", "bytes", "bytes"], [aHatEncoded, tr, t1Encoded]);
}
