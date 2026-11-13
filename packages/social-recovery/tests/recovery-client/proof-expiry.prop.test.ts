import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  fileReply,
  GATHERING_PROOF_EXPIRED_MESSAGE,
  KitRefusalError,
  RecoveryClient,
  type Address,
  type Finding,
  type Gathering,
  type Hex,
  type IRecoveryMethod,
  type MethodRegistry,
} from '../../src/index';
import { zkPassportMethod } from '../../src/method-zkpassport';
import { approvalGathering, PINNED_AT, placeEntry, replyFor, ruleHolds, TWO_CLAUSES_BODY, VALID_UNTIL } from '../gathering/support';
import { encodeConfig, encodeProof, outerInputs, PARAMS, stackDouble, word } from '../method-zkpassport/fixtures';
import { ACCOUNT, ACTION, CLIENT_CONFIGURATION, DESCRIPTOR, rig, runAsync, TIMEOUT } from './doubles';

/** The zkPassport module and a second module, registered checksummed while the places carry them lower-cased. */
const ZK = getAddress(`0x${'ab'.repeat(20)}`);
const OTHER = getAddress(`0x${'cd'.repeat(20)}`);

const PERIOD = 604_800;

/** A moment the pinned block's timestamp is within skew of, so the window alone raises nothing near it. */
const T = PINNED_AT + 100;

const PLACES = [0, 1, 2, 3] as const;

/** The places the two-clause body completes with when all four are filed and no selection is given. */
const PREFERRED: readonly number[] = [0, 1, 2];

/** Every selection of filed places that satisfies the two-clause body. */
const SELECTIONS: readonly (readonly number[])[] = Array.from({ length: 16 }, (_, mask) => PLACES.filter((place) => (mask >> place) & 1)).filter(
  (selection) => ruleHolds(TWO_CLAUSES_BODY, selection),
);

const zkConfig = (place: number): Hex => encodeConfig(word(0x100 + place), PARAMS.domain, PARAMS.scope, BigInt(PERIOD));

/** An outer proof dated so that, under the seven-day period, it expires at `expiresAt`. */
const proofExpiringAt = (expiresAt: number): Hex =>
  encodeProof(word(0x77), '0xabcdef01', outerInputs(0x0badc0ffeen).map((input, index) => (index === 2 ? word(expiresAt - PERIOD) : (input as Hex))), '0xbeef');

/** All four places filed in place order, place `p` expiring at `expiries[p]`, the places in `others` under `OTHER` and the rest under `ZK`. */
function mixedFiled(others: readonly number[], expiries: readonly number[]): Gathering {
  const methodOf = (place: number): Address => (others.includes(place) ? OTHER : ZK).toLowerCase() as Address;
  const start = approvalGathering(PLACES.map((place) => placeEntry(place, { method: methodOf(place), config: zkConfig(place) })));

  return PLACES.reduce<Gathering>((record, place) => {
    const filed = fileReply(record, replyFor(record, place, { proof: proofExpiringAt(expiries[place] as number) }));

    if (filed.outcome !== 'filed') throw new Error(`refused at ${place}`);

    return filed.gathering;
  }, start);
}

/** A recovery client over the rig's doubles with the given method registry. */
function clientWith(methods: MethodRegistry): RecoveryClient {
  const { parts, events, codec } = rig();

  return new RecoveryClient(parts.provider, DESCRIPTOR, ACCOUNT, ACTION, CLIENT_CONFIGURATION, parts.manager, parts.action, events, methods, codec);
}

/** A zkPassport method whose codec sits behind a proxy that records every member asked of it. */
function recordingMethod(): { readonly method: IRecoveryMethod; readonly asked: string[] } {
  const asked: string[] = [];
  const { codec } = zkPassportMethod({ stack: stackDouble().stack });
  const spy = new Proxy(codec, {
    get: (target, key, receiver): unknown => {
      asked.push(`get ${String(key)}`);

      return Reflect.get(target, key, receiver);
    },
    has: (target, key) => {
      asked.push(`has ${String(key)}`);

      return Reflect.has(target, key);
    },
    getOwnPropertyDescriptor: (target, key) => {
      asked.push(`describe ${String(key)}`);

      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    ownKeys: (target) => {
      asked.push('keys');

      return Reflect.ownKeys(target);
    },
  });

  return { method: { codec: spy } as IRecoveryMethod, asked };
}

/** The zkPassport module at `ZK` and the given implementation at `OTHER`. */
const mixedRegistry = (other: IRecoveryMethod): MethodRegistry => new Map([[ZK, zkPassportMethod({ stack: stackDouble().stack })], [OTHER, other]]);

/** A finding with every integer value as a bigint, so a number and a bigint of one value compare equal. */
const integral = (finding: Finding): unknown => ({
  ...finding,
  values: Object.fromEntries(Object.entries(finding.values).map(([name, value]) => [name, typeof value === 'number' ? BigInt(value) : value])),
});

const expired = (place: number, expiresAt: number, moment: number) => ({
  code: 'proof.expired',
  subject: 'request',
  values: { place: BigInt(place), expiresAt: BigInt(expiresAt), moment: BigInt(moment) },
});

const expiring = (place: number, expiresAt: number) => ({
  code: 'proof.expiring',
  subject: 'request',
  values: { place: BigInt(place), expiresAt: BigInt(expiresAt), validUntil: BigInt(VALID_UNTIL) },
});

/** Lets the vitest worker answer its RPC between synchronous runs. */
const yieldToWorker = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

const outcome = (run: () => unknown): { value?: unknown; thrown?: unknown } => {
  try {
    return { value: run() };
  } catch (thrown) {
    return { thrown };
  }
};

const proofPlaces = (request: unknown): number[] => (request as { proofs: { place: number }[] }).proofs.map((proof) => proof.place);

const momentArb = fc.integer({ min: T - 3, max: T + 3 });

const expiriesArb = fc.array(momentArb, { minLength: PLACES.length, maxLength: PLACES.length });

/** Expiries, a moment, a selection or none, and a set of places the completion leaves out, which go under `OTHER`. */
const completionArb = fc
  .tuple(expiriesArb, momentArb, fc.option(fc.constantFrom(...SELECTIONS), { nil: undefined }))
  .chain(([expiries, now, selection]) =>
    fc.subarray(PLACES.filter((place) => !(selection ?? PREFERRED).includes(place))).map((others) => ({ expiries, now, selection, others })),
  );

describe('proof expiry over arbitrary records of two aging modules', () => {
  it('complete refuses exactly the chosen expired places and never asks an unchosen place\'s codec', async () => {
    await runAsync(
      fc.asyncProperty(completionArb, async ({ expiries, now, selection, others }) => {
        await yieldToWorker();

        const record = mixedFiled(others, expiries);
        const { method, asked } = recordingMethod();
        const reference = clientWith(new Map()).complete(record, selection, now);
        const chosen = proofPlaces(reference);
        const due = chosen.filter((place) => (expiries[place] as number) <= now);
        const { value, thrown } = outcome(() => clientWith(mixedRegistry(method)).complete(record, selection, now));

        expect(chosen).toEqual([...(selection ?? PREFERRED)].sort((left, right) => left - right));
        expect(asked).toEqual([]);

        if (due.length === 0) {
          expect(value).toStrictEqual(reference);

          return;
        }

        expect(thrown).toBeInstanceOf(KitRefusalError);
        expect((thrown as KitRefusalError).message).toBe(GATHERING_PROOF_EXPIRED_MESSAGE);
        expect((thrown as KitRefusalError).findings?.warnings).toEqual([]);
        expect((thrown as KitRefusalError).findings?.errors.map(integral)).toEqual(due.map((place) => expired(place, expiries[place] as number, now)));
      }),
    );
  }, TIMEOUT);

  it('assess asks the codec of every filed place and reports each one, whichever module it is under', async () => {
    await runAsync(
      fc.asyncProperty(expiriesArb, momentArb, fc.subarray([...PLACES]), async (expiries, now, others) => {
        await yieldToWorker();

        const { method, asked } = recordingMethod();
        const findings = clientWith(mixedRegistry(method)).assess(mixedFiled(others, expiries), now).findings.map(integral);
        const at = (place: number): number => expiries[place] as number;

        expect(findings).toEqual([
          ...PLACES.filter((place) => at(place) <= now).map((place) => expired(place, at(place), now)),
          ...PLACES.filter((place) => at(place) > now).map((place) => expiring(place, at(place))),
        ]);
        expect(asked.length > 0).toBe(others.length > 0);
      }),
    );
  }, TIMEOUT);
});
