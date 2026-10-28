import fc from 'fast-check';
import type { Hex } from '../../src/interfaces';
import { HALF_N, N, parseDer, proofBytes, type AssertionParts } from './fixtures';

const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 256);
const seed = process.env['FC_SEED'] === undefined ? undefined : Number(process.env['FC_SEED']);

/** The fast-check run count from `FC_NUM_RUNS` (256 by default) and the seed from `FC_SEED` where set. */
export const parameters = { numRuns, ...(seed === undefined ? {} : { seed }) };

/** The vitest timeout of one property: a deep run must still finish, the budget is checked by its recorded time. */
export const PROPERTY_TIMEOUT = 60 * 60 * 1000;

/** Lets the vitest worker answer its RPC between synchronous signing runs. */
export const yieldToWorker = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

/** The hex with byte `index` (mod its length) XORed by `mask`. */
export const corrupt = (hex: Hex, index: number, mask: number): Hex => {
  const bytes = Buffer.from(hex.slice(2), 'hex');
  const at = index % bytes.length;

  bytes[at] = (bytes[at] ?? 0) ^ mask;

  return `0x${bytes.toString('hex')}`;
};

/** The proof packaged by hand from the signed parts, with a high s lowered to n - s. */
export const handProof = (parts: AssertionParts): Hex => {
  const { r, s } = parseDer(parts.signature);

  return proofBytes(parts.authenticatorData, parts.clientDataJSON, r, s > HALF_N ? N - s : s);
};

/** A P-256 private scalar in [1, n-1]. */
export const scalarArb = fc.bigInt({ min: 1n, max: N - 1n });

/** A 32-byte digest. */
export const digestArb = fc.uint8Array({ minLength: 32, maxLength: 32 });
