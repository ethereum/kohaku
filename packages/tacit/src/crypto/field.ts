/**
 * BabyJubJub over the BN254 scalar field, in the twisted Edwards form circomlib uses:
 * `a·u² + v² = 1 + d·u²·v²`.
 */
import { mod, modInv, modSqrt } from "./modular";
import { L_BJJ, P_FR } from "./params";

export type Point = readonly [bigint, bigint];

type Projective = [bigint, bigint, bigint];

export { L_BJJ, P_FR };
export const BASE8: Point = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];

const A_TE = 168700n;
const D_TE = 168696n;
const HALF = (P_FR - 1n) / 2n;

// Projective addition (add-2008-bbjlp): complete on BabyJubJub, so no case splits.
function addProjective([x1, y1, z1]: Projective, [x2, y2, z2]: Projective): Projective {
  const a = mod(z1 * z2);
  const b = mod(a * a);
  const c = mod(x1 * x2);
  const d = mod(y1 * y2);
  const e = mod(((D_TE * c) % P_FR) * d);
  const f = mod(b - e);
  const g = mod(b + e);

  return [
    mod(((a * f) % P_FR) * mod((x1 + y1) * (x2 + y2) - c - d)),
    mod(((a * g) % P_FR) * mod(d - A_TE * c)),
    mod(f * g),
  ];
}

function toAffine([x, y, z]: Projective): Point {
  const zInv = modInv(z);

  return [mod(x * zInv), mod(y * zInv)];
}

export const addPoint = (p: Point, q: Point): Point => toAffine(addProjective([p[0], p[1], 1n], [q[0], q[1], 1n]));

/** k·P for a non-negative scalar. */
export function mulPoint(point: Point, k: bigint | number): Point {
  let e = BigInt(k);

  if (e < 0n) throw new Error("tacit: negative scalar");

  let acc: Projective = [0n, 1n, 1n];
  let step: Projective = [point[0], point[1], 1n];

  while (e > 0n) {
    if (e & 1n) acc = addProjective(acc, step);

    step = addProjective(step, step);
    e >>= 1n;
  }

  return toAffine(acc);
}

let base8Table: Projective[] | null = null;

/** k·Base8, from a table of doublings built on first use. */
export function mulB8(k: bigint | number): Point {
  if (!base8Table) {
    const table: Projective[] = [[BASE8[0], BASE8[1], 1n]];

    for (let i = 1; i < 253; i++) table.push(addProjective(table[i - 1]!, table[i - 1]!));

    base8Table = table;
  }

  let e = BigInt(k) % L_BJJ;
  let acc: Projective = [0n, 1n, 1n];

  for (let i = 0; e > 0n; i++, e >>= 1n) {
    if (e & 1n) acc = addProjective(acc, base8Table[i]!);
  }

  return toAffine(acc);
}

export const isIdentity = (p: Point): boolean => p[0] === 0n && p[1] === 1n;

export const inSubgroup = (p: Point): boolean => isIdentity(p) || isIdentity(mulPoint(p, L_BJJ));

/** circomlib `packPoint`: v little-endian, the sign of u in the top bit. */
export function packPoint(p: Point): Uint8Array {
  const out = new Uint8Array(32);
  let v = p[1];

  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }

  if (p[0] > HALF) out[31] = out[31]! | 0x80;

  return out;
}

/** Inverse of {@link packPoint}; null unless the bytes name a subgroup point. */
export function unpackPoint(bytes: Uint8Array): Point | null {
  if (bytes.length !== 32) return null;

  const work = Uint8Array.from(bytes);
  const negative = (work[31]! & 0x80) !== 0;

  work[31] = work[31]! & 0x7f;

  let v = 0n;

  for (let i = 31; i >= 0; i--) v = (v << 8n) | BigInt(work[i]!);

  if (v >= P_FR) return null;

  const v2 = (v * v) % P_FR;
  const den = mod(A_TE - ((D_TE * v2) % P_FR));

  if (den === 0n) return null;

  let u = modSqrt(mod(1n - v2) * modInv(den));

  if (u === null) return null;

  if ((u > HALF) !== negative) u = mod(-u);

  const point: Point = [u, v];

  return inSubgroup(point) ? point : null;
}
