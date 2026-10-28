import fc from 'fast-check';
import type { ApprovalMembers, Hex, SetupBody } from '../../src/index';
import { UINT48_MAX } from './support';

const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 256);
const seedText = process.env['FC_SEED'];
const params: fc.Parameters<unknown> = seedText === undefined ? { numRuns } : { numRuns, seed: Number(seedText) };

/** A per-test timeout that grows with the run count, never below vitest's 5 s default. */
export const TIMEOUT = Math.max(5_000, numRuns * 10);

/** Asserts a property under the run count and seed taken from `FC_NUM_RUNS` and `FC_SEED`. */
export const run = <T>(property: fc.IProperty<T>): void => fc.assert(property, params as fc.Parameters<T>);

const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`;

export const bytesN = (n: number): fc.Arbitrary<Hex> => fc.uint8Array({ minLength: n, maxLength: n }).map(toHex);
export const anyBytes = fc.uint8Array({ maxLength: 96 }).map(toHex);
export const address = bytesN(20);
export const uint = (bits: number): fc.Arbitrary<bigint> => fc.bigInt({ min: 0n, max: (1n << BigInt(bits)) - 1n });
export const safeInt = (min: number, max: number): fc.Arbitrary<number> =>
  fc.bigInt({ min: BigInt(min), max: BigInt(max) }).map(Number);
export const uint48 = fc.oneof(fc.constantFrom(0, UINT48_MAX), safeInt(0, UINT48_MAX));
export const place = fc.oneof(fc.nat(64), safeInt(0, Number.MAX_SAFE_INTEGER));

const clause = fc.record({ threshold: fc.integer({ min: 0, max: 255 }), credentials: fc.array(bytesN(32), { maxLength: 5 }) });

export const body: fc.Arbitrary<SetupBody> = fc.record({
  wait: uint48,
  ignoresPause: fc.boolean(),
  clauses: fc.array(clause, { maxLength: 5 }),
});

export const members: fc.Arbitrary<ApprovalMembers> = fc.record({
  chainId: safeInt(0, Number.MAX_SAFE_INTEGER),
  manager: address,
  account: address,
  action: address,
  attemptId: uint(64),
  setupNonce: uint(64),
  setupBodyHash: bytesN(32),
  validUntil: uint48,
  payload: anyBytes,
  order: fc.record({ token: address, amount: uint(256), payee: address }),
});
