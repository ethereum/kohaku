import * as zkp from 'micro-zk-proofs';
import { bn254 } from '@noble/curves/bn254.js';
import * as zkpWitness from 'micro-zk-proofs/witness.js';
import * as zkpMsm from 'micro-zk-proofs/msm.js';
import { ITornadoProver } from './tornado-prover';
import { toHex as viemToHex } from 'viem';
import { bytesToNumberLE } from '@noble/curves/utils.js';

// Montgomery factor R = 2^256.
const Fp = bn254.fields.Fp;
const Fr = bn254.fields.Fr;
const FP_R_INV = Fp.inv(2n ** 256n % Fp.ORDER);
const FR_R_INV = Fr.inv(2n ** 256n % Fr.ORDER);

const fromMontgomeryFp = (x: bigint): bigint => Fp.mul(x, FP_R_INV);
const fromMontgomeryFr = (x: bigint): bigint => Fr.mul(x, FR_R_INV);

// Returns null for the identity so G1c.decode(null) / G2c.decode(null) returns Point.ZERO.
// Old snarkjs affine identity: G1=(x=0,y=1), G2=(x=(0,0),y=(1,0)).
function readG1(bytes: Uint8Array, offset: number): zkp.G1Point | null {
  const x = fromMontgomeryFp(bytesToNumberLE(bytes.subarray(offset, offset + 32)));
  const y = fromMontgomeryFp(bytesToNumberLE(bytes.subarray(offset + 32, offset + 64)));

  if (x === 0n && y === 1n) return null;

  return [x, y, 1n];
}

function readG2(bytes: Uint8Array, offset: number): zkp.G2Point | null {
  // Binary layout: [c0=imag, c1=real] per Fp2 component (noble-curves: c0=imaginary, c1=real).
  const x0 = fromMontgomeryFp(bytesToNumberLE(bytes.subarray(offset,       offset + 32)));
  const x1 = fromMontgomeryFp(bytesToNumberLE(bytes.subarray(offset + 32,  offset + 64)));
  const y0 = fromMontgomeryFp(bytesToNumberLE(bytes.subarray(offset + 64,  offset + 96)));
  const y1 = fromMontgomeryFp(bytesToNumberLE(bytes.subarray(offset + 96,  offset + 128)));

  if (x0 === 0n && x1 === 0n && y0 === 1n && y1 === 0n) return null;

  return [[x0, x1], [y0, y1], [1n, 0n]];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseProvingKey = (pkeyBuf: ArrayBuffer, circuit: any): zkp.ProvingKey => {
  const dv    = new DataView(pkeyBuf);
  const bytes = new Uint8Array(pkeyBuf);

  const nVars      = dv.getUint32(0,  true);
  const nPublic    = dv.getUint32(4,  true);
  const domainSize = dv.getUint32(8,  true);
  const pPolsA     = dv.getUint32(12, true);
  const pPolsB     = dv.getUint32(16, true);
  const pPointsA   = dv.getUint32(20, true);
  const pPointsB1  = dv.getUint32(24, true);
  const pPointsB2  = dv.getUint32(28, true);
  const pPointsC   = dv.getUint32(32, true);
  const pHExps     = dv.getUint32(36, true);

  const FIXED = 40;
  const vk_alfa_1  = readG1(bytes, FIXED)       as zkp.G1Point;
  const vk_beta_1  = readG1(bytes, FIXED + 64)  as zkp.G1Point;
  const vk_delta_1 = readG1(bytes, FIXED + 128) as zkp.G1Point;
  const vk_beta_2  = readG2(bytes, FIXED + 192) as zkp.G2Point;
  const vk_delta_2 = readG2(bytes, FIXED + 320) as zkp.G2Point;

  const parsePols = (startOffset: number): zkp.Constraint[] => {
    const pols: zkp.Constraint[] = [];
    let off = startOffset;

    for (let s = 0; s < nVars; s++) {
      const pol: zkp.Constraint = {};
      const numEntries = dv.getUint32(off, true);

      off += 4;

      for (let j = 0; j < numEntries; j++) {
        const cIdx  = dv.getUint32(off, true);

        off += 4;
        const coeff = fromMontgomeryFr(bytesToNumberLE(bytes.subarray(off, off + 32)));

        off += 32;

        if (coeff !== 0n) pol[cIdx] = coeff;
      }
      pols.push(pol);
    }

    return pols;
  };

  const polsA = parsePols(pPolsA);
  const polsB = parsePols(pPolsB);

  // polsC is not stored in the binary key but the upper-half slice in calculateH is independent of
  // polsC (since deg(C) < m, subtracting it only affects the lower half of A·B).  Empty polsC is
  // therefore equivalent to the correct one for the h computation.
  void circuit;
  const polsC: zkp.Constraint[] = Array.from({ length: nVars }, () => ({}));

  const readG1s = (offset: number, count: number): zkp.G1Point[] =>
    Array.from({ length: count }, (_, i) => readG1(bytes, offset + i * 64)) as unknown as zkp.G1Point[];

  const readG2s = (offset: number, count: number): zkp.G2Point[] =>
    Array.from({ length: count }, (_, i) => readG2(bytes, offset + i * 128)) as unknown as zkp.G2Point[];

  const A     = readG1s(pPointsA,  nVars);
  const B1    = readG1s(pPointsB1, nVars);
  const B2    = readG2s(pPointsB2, nVars);
  const hExps = readG1s(pHExps,    domainSize - 1);

  const rawC = readG1s(pPointsC, nVars - nPublic - 1);
  const C = [
    ...new Array(nPublic + 1).fill(null),
    ...rawC,
  ] as unknown as zkp.G1Point[];

  return {
    nVars, nPublic, domainBits: Math.log2(domainSize), domainSize,
    polsA, polsB, polsC,
    A, B1, B2, C, hExps,
    vk_alfa_1, vk_beta_1, vk_delta_1, vk_beta_2, vk_delta_2,
  };
};

function toSolidityInput({ proof }: zkp.ProofWithSignals): `0x${string}` {
  // G2c.encode gives [[c0=imag, c1=real], ...].  Verifier.sol reads X[0] as real (xr) and
  // X[1] as imaginary (xi), so emit [c1_real, c0_imag].
  const flat = zkp.stringBigints.decode([
    proof.pi_a[0], proof.pi_a[1],
    proof.pi_b[0][1], proof.pi_b[0][0],
    proof.pi_b[1][1], proof.pi_b[1][0],
    proof.pi_c[0], proof.pi_c[1],
  ]);

  return ('0x' + flat.map(x => x.toString(16).padStart(64, '0')).join('')) as `0x${string}`;
}

export const createTornadoProver = async (circuit: object, provingKey: ArrayBuffer): Promise<ITornadoProver> => {
  const msm = zkpMsm.initMSM();
  // NQR=7: the tornadoProvingKey.bin was built with websnark which uses NQR=7 (bn128.js:
  // buildFFT(moduleBuilder, "fft", "frm", bigInt(7))). noble-curves defaults to NQR=5.
  // Using a different NQR gives different roots of unity → different h polynomial → invalid proofs.
  const { groth } = zkp.buildSnark(bn254, {
    nqr: 7,
    G1msm: msm.methods.bn254_msmG1,
    G2msm: msm.methods.bn254_msmG2,
  });

  const pkey = parseProvingKey(provingKey, circuit);

  return {
    async prove(inputs) {
      const witness = zkpWitness.generateWitness(circuit)(inputs);
      const proofJs = await groth.createProof(pkey, witness);

      return {
        proof: toSolidityInput(proofJs),
        args: [
          viemToHex(inputs.root,         { size: 32 }),
          viemToHex(inputs.nullifierHash, { size: 32 }),
          viemToHex(inputs.recipient,     { size: 20 }),
          viemToHex(inputs.relayer,       { size: 20 }),
          viemToHex(inputs.fee,           { size: 32 }),
          viemToHex(inputs.refund,        { size: 32 }),
        ],
      };
    },
  };
};
