import fc from 'fast-check';
import { getAddress } from 'viem';
import type { Address, Gathering, GatheringPlace, Hex } from '../../src/index';
import { address, anyBytes, bytesN, safeInt, uint } from '../formats/arbitraries';
import { LETTERED_METHOD, OTHER_METHOD } from './doubles';

const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 256);
const seedText = process.env['FC_SEED'];

/** Asserts an async property under `FC_NUM_RUNS` (or the given count) and `FC_SEED`. */
export const runAsync = <T>(property: fc.IAsyncProperty<T>, runs: number = numRuns): Promise<void> =>
  fc.assert(property, seedText === undefined ? { numRuns: runs } : { numRuns: runs, seed: Number(seedText) });

/** The run count for a slice that signs with a real key, a twentieth of the configured runs and at least ten. */
export const SIGNING_RUNS = Math.max(10, Math.floor(numRuns / 20));

/** The method addresses a generated place may name. */
export const METHODS: readonly Address[] = [LETTERED_METHOD, OTHER_METHOD];

/** An address in one of its accepted spellings: lower case, upper case or checksummed. */
export const spelled = (value: Address): fc.Arbitrary<Address> =>
  fc.constantFrom(value.toLowerCase() as Address, `0x${value.slice(2).toUpperCase()}` as Address, getAddress(value));

const anyAddress = address.chain((value) => spelled(value as Address));

const decimal = (bits: number): fc.Arbitrary<string> => uint(bits).map(String);

const placeArb = (place: number): fc.Arbitrary<GatheringPlace> =>
  fc.record({
    method: fc.constantFrom(...METHODS).chain(spelled),
    config: anyBytes,
    salt: bytesN(32),
    credentialHoldsCode: fc.boolean(),
  }).map((entry) => ({ place, ...entry, standing: 'not-stopped', stoppable: false }));

const placesArb: fc.Arbitrary<GatheringPlace[]> = fc
  .integer({ min: 1, max: 5 })
  .chain((count) => fc.tuple(...Array.from({ length: count }, (_v, place) => placeArb(place))));

const membersArb = fc.record({
  chainId: safeInt(1, Number.MAX_SAFE_INTEGER).map(String),
  manager: anyAddress,
  digestVersion: fc.oneof(fc.constant('1'), safeInt(0, Number.MAX_SAFE_INTEGER).map(String)),
  account: anyAddress,
  action: anyAddress,
  attemptId: decimal(64),
  setupNonce: decimal(64),
  setupBody: anyBytes,
  validUntil: decimal(48),
  block: fc.constant({ number: 1, timestamp: '0', hash: `0x${'bb'.repeat(32)}` as Hex }),
});

/** A readable gathering of either purpose over arbitrary members and one to five places. */
export const gatheringArb: fc.Arbitrary<Gathering> = fc
  .record({
    members: membersArb,
    places: placesArb,
    purpose: fc.constantFrom('approval' as const, 'cancellation' as const),
    payload: anyBytes,
    order: fc.record({ token: anyAddress, amount: decimal(256), payee: anyAddress }),
    consumableAfter: decimal(48),
  })
  .map(({ members, places, purpose, payload, order, consumableAfter }): Gathering =>
    purpose === 'approval'
      ? { kind: 'gathering', version: 1, purpose, request: { ...members, payload, order }, places, replies: [] }
      : { kind: 'gathering', version: 1, purpose, request: { ...members, consumableAfter }, places, replies: [] },
  );
