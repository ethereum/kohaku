import { keccak256, stringToBytes, fromHex } from 'viem';
import { MerkleTree } from 'fixed-merkle-tree';
import { addPoint, mulPointEscalar } from '@zk-kit/baby-jubjub';

const subOrder = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;

// Tornado Merkle tree parameters
const TREE_LEVELS = 20;
// keccak256("tornado") % SNARK_SCALAR_FIELD
const ZERO_VALUE = '21663839004416932945382355908790599225266501822907911457504978515578255421292';

// BN128 scalar field prime
const p = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const NROUNDS = 220;

// MiMC-Sponge round constants: keccak256("mimcsponge") iterated, reduced mod p.
// Matches circomlibjs MimcSponge.getConstants exactly.
function computeMimcConstants(): bigint[] {
  const cts = new Array<bigint>(NROUNDS);
  let c = keccak256(stringToBytes('mimcsponge'));

  cts[0] = 0n;

  for (let i = 1; i < NROUNDS; i++) {
    c = keccak256(fromHex(c, 'bytes'));
    cts[i] = BigInt(c) % p;
  }
  cts[NROUNDS - 1] = 0n;

  return cts;
}

const MIMC_CONSTANTS = computeMimcConstants();

function mimcHash(xL: bigint, xR: bigint, k: bigint): { xL: bigint; xR: bigint } {
  for (let i = 0; i < NROUNDS; i++) {
    const t = i === 0 ? (xL + k) % p : (xL + k + MIMC_CONSTANTS[i]!) % p;
    const t2 = (t * t) % p;
    const t4 = (t2 * t2) % p;
    const t5 = (t4 * t) % p;

    if (i < NROUNDS - 1) {
      const newXL = (xR + t5) % p;

      xR = xL;
      xL = newXL;
    } else {
      xR = (xR + t5) % p;
    }
  }

  return { xL, xR };
}

function mimcMultiHash(arr: bigint[]): bigint {
  let R = 0n;
  let C = 0n;

  for (const x of arr) {
    R = (R + x) % p;
    const s = mimcHash(R, C, 0n);

    R = s.xL;
    C = s.xR;
  }

  return R;
}

async function buildTree(leaves: bigint[]): Promise<MerkleTree> {
  const hashFunction = (left: string | number, right: string | number) =>
    mimcMultiHash([BigInt(left), BigInt(right)]).toString();

  return new MerkleTree(TREE_LEVELS, leaves.map(String), {
    zeroElement: ZERO_VALUE,
    hashFunction,
  });
}

export async function computeMerkleTreeRoot(leaves: bigint[]): Promise<bigint> {
  return BigInt((await buildTree(leaves)).root);
}

// Base points for the circomlib v2.0.5 Pedersen hash circuit, generated with Blake1/256.
// These are hardcoded in the circuit's pedersen.circom as BASE[10][2].
// Pedersen(248) needs indices 0-1; Pedersen(496) needs 0-2.
const PEDERSEN_BASE_POINTS: [bigint, bigint][] = [
  [10457101036533406547632367118273992217979173478358440826365724437999023779287n, 19824078218392094440610104313265183977899662750282163392862422243483260492317n],
  [2671756056509184035029146175565761955751135805354291559563293617232983272177n,   2663205510731142763556352975002641716101654201788071096152948830924149045094n],
  [5802099305472655231388284418920769829666717045250560929368476121199858275951n,   5980429700218124965372158798884772646841287887664001482443826541541529227896n],
];

// Pedersen hash over Baby JubJub — matches circomlibjs/circomlib v2.0.5 (windowSize=4, 50 windows/segment).
export function pedersenHash(msg: Uint8Array): bigint {
  const WINDOW_SIZE = 4;
  const N_WINDOWS_PER_SEGMENT = 50;
  const BITS_PER_SEGMENT = WINDOW_SIZE * N_WINDOWS_PER_SEGMENT; // 200

  const bits: number[] = [];

  for (const byte of msg) {
    for (let b = 0; b < 8; b++) bits.push((byte >> b) & 1);
  }

  const nSegments = Math.floor((bits.length - 1) / BITS_PER_SEGMENT) + 1;
  let accP: [bigint, bigint] = [0n, 1n]; // identity

  for (let s = 0; s < nSegments; s++) {
    const nWindows = s === nSegments - 1
      ? Math.floor(((bits.length - (nSegments - 1) * BITS_PER_SEGMENT) - 1) / WINDOW_SIZE) + 1
      : N_WINDOWS_PER_SEGMENT;

    let escalar = 0n;
    let exp = 1n;

    for (let w = 0; w < nWindows; w++) {
      let o = s * BITS_PER_SEGMENT + w * WINDOW_SIZE;
      let acc = 1n;

      for (let b = 0; b < WINDOW_SIZE - 1 && o < bits.length; b++, o++) {
        if (bits[o]) acc += (1n << BigInt(b));
      }

      if (o < bits.length) {
        if (bits[o]) acc = -acc;

        o++;
      }

      escalar += acc * exp;
      exp <<= BigInt(WINDOW_SIZE + 1);
    }

    if (escalar < 0n) escalar += subOrder;

    const base = PEDERSEN_BASE_POINTS[s]!;

    accP = addPoint(accP, mulPointEscalar(base, escalar));
  }

  return accP[0];
}

export type MerkleProof = {
  index: number;
  root: bigint;
  siblings: bigint[];
  pathIndices: number[];
};

/**
 * Generates a Merkle inclusion proof for a given leaf in a set of leaves.
 *
 * @param {bigint[]} leaves - All commitment leaves for the tornado pool.
 * @param {bigint} leaf - The specific commitment to generate the proof for.
 * @returns {MerkleProof} Merkle proof compatible with the tornado withdraw circuit.
 * @throws {Error} If the leaf is not found in the leaves array.
 */
export async function generateMerkleProof(leaves: bigint[], leaf: bigint): Promise<MerkleProof> {
  const tree = await buildTree(leaves);
  const leafStr = leaf.toString();
  const index = tree.indexOf(leafStr);

  if (index === -1) throw new Error('Leaf not found in the leaves array.');

  const { pathElements, pathIndices, pathRoot } = tree.proof(leafStr);

  return {
    index,
    root: BigInt(pathRoot),
    siblings: pathElements.map(BigInt),
    pathIndices,
  };
}
