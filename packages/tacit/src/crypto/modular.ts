/** Arithmetic modulo a prime (default: the BN254 scalar field). */
import { P_FR } from "./params";

export const mod = (x: bigint, p: bigint = P_FR): bigint => ((x % p) + p) % p;

export function modPow(base: bigint, exp: bigint, p: bigint = P_FR): bigint {
  let result = 1n;
  let b = mod(base, p);
  let e = exp;

  while (e > 0n) {
    if (e & 1n) result = (result * b) % p;

    b = (b * b) % p;
    e >>= 1n;
  }

  return result;
}

export function modInv(a: bigint, p: bigint = P_FR): bigint {
  let [r0, r1] = [mod(a, p), p];
  let [s0, s1] = [1n, 0n];

  while (r1 !== 0n) {
    const q = r0 / r1;

    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }

  if (r0 !== 1n) throw new Error("tacit: not invertible");

  return mod(s0, p);
}

/** Tonelli–Shanks; null when `n` is not a square. */
export function modSqrt(n: bigint, p: bigint = P_FR): bigint | null {
  const x = mod(n, p);

  if (x === 0n) return 0n;

  if (modPow(x, (p - 1n) / 2n, p) !== 1n) return null;

  let q = p - 1n;
  let s = 0n;

  while ((q & 1n) === 0n) {
    q >>= 1n;
    s++;
  }

  let z = 2n;

  while (modPow(z, (p - 1n) / 2n, p) !== p - 1n) z++;

  let m = s;
  let c = modPow(z, q, p);
  let t = modPow(x, q, p);
  let r = modPow(x, (q + 1n) / 2n, p);

  while (t !== 1n) {
    let i = 0n;
    let tt = t;

    while (tt !== 1n) {
      tt = (tt * tt) % p;
      i++;
    }

    const b = modPow(c, 1n << (m - i - 1n), p);

    m = i;
    c = (b * b) % p;
    t = (t * c) % p;
    r = (r * b) % p;
  }

  return r;
}
