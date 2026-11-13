import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import * as core from '../../src/index';
import {
  fileReply,
  GATHERING_ORDER_REFUSAL_MESSAGES,
  GATHERING_PROOF_EXPIRED_MESSAGE,
  KitRefusalError,
  passkeyMethod,
  RecoveryClient,
  walletMethod,
  type Address,
  type Finding,
  type Gathering,
  type Hex,
  type IMethodCodec,
  type IRecoveryMethod,
  type MethodRegistry,
} from '../../src/index';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { zkPassportMethod } from '../../src/method-zkpassport';
import { approvalGathering, PINNED_AT, placeEntry, replyFor, VALID_UNTIL } from '../gathering/support';
import { jsDocOf, PACKAGE_ROOT, SRC_ROOT } from '../helpers/source';
import { encodeConfig, encodeProof, outerInputs, PARAMS, stackDouble, thrown, word } from '../method-zkpassport/fixtures';
import { ACCOUNT, ACTION, CLIENT_CONFIGURATION, DESCRIPTOR, rig } from './doubles';

/** The zkPassport module, registered checksummed while the places carry it lower-cased. */
const ZK = getAddress(`0x${'ab'.repeat(20)}`);

const PERIOD = 604_800;

/** A moment the pinned block's timestamp is within skew of, so the window alone raises nothing. */
const T = PINNED_AT + 100;

const zkConfig = (place: number): Hex => encodeConfig(word(0x100 + place), PARAMS.domain, PARAMS.scope, BigInt(PERIOD));

/** An outer proof dated so that, under the seven-day period, it expires at `expiresAt`. */
const proofExpiringAt = (expiresAt: number): Hex =>
  encodeProof(word(0x77), '0xabcdef01', outerInputs(0x0badc0ffeen).map((input, index) => (index === 2 ? word(expiresAt - PERIOD) : (input as Hex))), '0xbeef');

/** The blessed two-clause approval gathering over four places of `method`, with replies filed in place order, each with its proof. */
function gatheringWith(proofs: { readonly [place: number]: Hex }, method: Address = ZK.toLowerCase() as Address): Gathering {
  const start = approvalGathering([0, 1, 2, 3].map((place) => placeEntry(place, { method, config: zkConfig(place) })));

  return Object.entries(proofs).reduce<Gathering>((record, [place, proof]) => {
    const filed = fileReply(record, replyFor(record, Number(place), { proof }));

    if (filed.outcome !== 'filed') throw new Error(`refused at ${place}`);

    return filed.gathering;
  }, start);
}

/** Replies at the given places expiring at the given moments. */
const expiringAt = (expiries: { readonly [place: number]: number }): Gathering =>
  gatheringWith(Object.fromEntries(Object.entries(expiries).map(([place, at]) => [place, proofExpiringAt(at)])));

/** A recovery client over the rig's doubles with the given method registry. */
function clientWith(methods: MethodRegistry): RecoveryClient {
  const { parts, events, codec } = rig();

  return new RecoveryClient(parts.provider, DESCRIPTOR, ACCOUNT, ACTION, CLIENT_CONFIGURATION, parts.manager, parts.action, events, methods, codec);
}

const zkRegistry = (): MethodRegistry => new Map([[ZK, zkPassportMethod({ stack: stackDouble().stack })]]);

/** A method whose codec is the zkPassport one with `proofExpiry` replaced. */
const methodWith = (proofExpiry: unknown): IRecoveryMethod => {
  const { codec } = zkPassportMethod({ stack: stackDouble().stack });

  return { codec: { ...codec, proofExpiry } as IMethodCodec } as IRecoveryMethod;
};

/** A second module, registered checksummed while its places carry it lower-cased. */
const OTHER = getAddress(`0x${'cd'.repeat(20)}`);

/** All four places filed in place order with proofs expiring at the given moments, otherwise at `T + 50`, the places in `others` under `OTHER`. */
function mixedFiled(others: readonly number[], expiries: { readonly [place: number]: number } = {}): Gathering {
  const methodOf = (place: number): Address => (others.includes(place) ? OTHER : ZK).toLowerCase() as Address;
  const start = approvalGathering([0, 1, 2, 3].map((place) => placeEntry(place, { method: methodOf(place), config: zkConfig(place) })));

  return [0, 1, 2, 3].reduce<Gathering>((record, place) => {
    const filed = fileReply(record, replyFor(record, place, { proof: proofExpiringAt(expiries[place] ?? T + 50) }));

    if (filed.outcome !== 'filed') throw new Error(`refused at ${place}`);

    return filed.gathering;
  }, start);
}

/** The zkPassport module at `ZK` and the given implementation at `OTHER`. */
const mixedRegistry = (other: IRecoveryMethod): MethodRegistry => new Map([[ZK, zkPassportMethod({ stack: stackDouble().stack })], [OTHER, other]]);

/** A method whose zkPassport codec sits behind a proxy that records every member asked of it. */
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

/** A method whose zkPassport codec keeps its `proofExpiry` but whose `decodeConfig` is not a function. */
const decodeless = (): IRecoveryMethod => {
  const { codec } = zkPassportMethod({ stack: stackDouble().stack });

  return { codec: { ...codec, decodeConfig: 'none' } as unknown as IMethodCodec } as IRecoveryMethod;
};

/** Implementations the strict codec check refuses, each with the tail of the `TypeError` message it raises for a place of `OTHER`. */
const MISCONFIGURED: readonly (readonly [string, () => IRecoveryMethod, string])[] = [
  ['has a number for proofExpiry', () => methodWith(5), 'codec.proofExpiry must be a function'],
  ['has a string for proofExpiry', () => methodWith('soon'), 'codec.proofExpiry must be a function'],
  ['has null for proofExpiry', () => methodWith(null), 'codec.proofExpiry must be a function'],
  ['has a record for proofExpiry', () => methodWith({ expiry: 1 }), 'codec.proofExpiry must be a function'],
  ['is not an object', () => ({ codec: 7 }) as unknown as IRecoveryMethod, 'codec must be an object'],
  ['has a proofExpiry but no decodeConfig function', decodeless, 'codec.decodeConfig must be a function'],
];

/** The `TypeError` message the strict check raises for a place of `OTHER`. */
const otherMessage = (tail: string): string => `methods.get(${OTHER.toLowerCase()}).${tail}`;

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

const assessed = (client: RecoveryClient, record: Gathering, now: number): unknown[] => client.assess(record, now).findings.map(integral);

/** The refusal `complete` throws, failing loudly where it returns. */
function refusalOf(run: () => unknown): KitRefusalError {
  try {
    run();
  } catch (error) {
    if (error instanceof KitRefusalError) return error;

    throw error;
  }

  throw new Error('expected a refusal, complete returned');
}

const proofPlaces = (request: unknown): number[] => (request as { proofs: { place: number }[] }).proofs.map((proof) => proof.place);

describe('assess reports when a filed zkPassport proof expires', () => {
  it.each([
    ['one second before its expiry, which the window still holds', T, T - 1, [expiring(0, T)]],
    ['at its expiry', T, T, [expired(0, T, T)]],
    ['one second after its expiry', T, T + 1, [expired(0, T, T + 1)]],
    ['expiring exactly at the window\'s end', VALID_UNTIL, PINNED_AT, [expiring(0, VALID_UNTIL)]],
    ['expiring one second after the window\'s end', VALID_UNTIL + 1, PINNED_AT, []],
    ['expiring long after the window', VALID_UNTIL + PERIOD, PINNED_AT, []],
  ] as const)('a proof %s', (_why, expiresAt, now, findings) => {
    expect(assessed(clientWith(zkRegistry()), expiringAt({ 0: expiresAt }), now)).toEqual(findings);
  });

  it('the window\'s rows come first, then the expired proofs, then the expiring ones, each in place order', () => {
    const now = T + 1_000;
    const record = expiringAt({ 0: now + 1, 1: now, 2: now + 2, 3: now - 5 });
    const findings = assessed(clientWith(zkRegistry()), record, now);

    expect(findings.map((finding) => (finding as Finding).code)).toEqual([
      'request.moment-skew',
      'proof.expired',
      'proof.expired',
      'proof.expiring',
      'proof.expiring',
    ]);
    expect(findings.slice(1)).toEqual([expired(1, now, now), expired(3, now - 5, now), expiring(0, now + 1), expiring(2, now + 2)]);
  });

  it('a window error and its warnings come before an expired proof', () => {
    const now = VALID_UNTIL + 1;
    const findings = assessed(clientWith(zkRegistry()), expiringAt({ 0: T }), now);

    expect(findings.map((finding) => (finding as Finding).code)).toEqual(['request.expired', 'request.moment-skew', 'proof.expired']);
    expect(findings.at(-1)).toEqual(expired(0, T, now));
  });

  it('the rest of the assessment is the one a client without the method reports', () => {
    const record = expiringAt({ 0: T, 2: T + 5 });
    const plain = clientWith(new Map()).assess(record, T);
    const aware = clientWith(zkRegistry()).assess(record, T);

    expect({ ...aware, findings: [] }).toEqual({ ...plain, findings: [] });
    expect(plain.findings).toEqual([]);
  });

  it('reads the record without changing it', () => {
    const record = expiringAt({ 0: T, 1: T + 5 });
    const before = structuredClone(record);

    clientWith(zkRegistry()).assess(record, T);

    expect(record).toEqual(before);
  });

  it.each<[string, () => MethodRegistry, () => Gathering]>([
    ['the place\'s method is not registered', () => new Map(), () => expiringAt({ 0: T })],
    ['another module is registered', () => new Map([[getAddress(`0x${'cd'.repeat(20)}`), zkPassportMethod({ stack: stackDouble().stack })]]), () => expiringAt({ 0: T })],
    ['the place\'s method is a wallet method, whose codec has no proofExpiry', () => new Map([[ZK, walletMethod()]]), () => expiringAt({ 0: T })],
    ['the proof does not decode, so the codec throws', zkRegistry, () => gatheringWith({ 0: '0xd0' })],
    ['the proof has seven public inputs, so the codec throws', zkRegistry, () => gatheringWith({ 0: encodeProof(word(1), '0x', outerInputs(1n).slice(0, 7) as Hex[], '0x') })],
    ['the codec\'s proofExpiry throws', () => new Map([[ZK, methodWith(() => { throw new Error('double: no expiry'); })]]), () => expiringAt({ 0: T })],
  ])('nothing is reported where %s', (_why, registry, record) => {
    expect(clientWith(registry()).assess(record(), T).findings).toEqual([]);
  });

  it.each([
    ['a number', 5],
    ['a string', 'soon'],
    ['null', null],
    ['a record', { expiry: 1 }],
  ])('a codec whose proofExpiry is %s, not a function, makes assess throw a TypeError', (_why, member) => {
    expect(() => clientWith(new Map([[ZK, methodWith(member)]])).assess(expiringAt({ 0: T }), T)).toThrow(TypeError);
  });

  it('a codec whose proofExpiry is undefined is skipped like one without the member', () => {
    expect(clientWith(new Map([[ZK, methodWith(undefined)]])).assess(expiringAt({ 0: T }), T).findings).toEqual([]);
  });
});

describe('complete refuses a chosen proof that has expired', () => {
  /** All four places filed in place order; the preferred set is places 0, 1 and 2. */
  const allFiled = (expiries: { readonly [place: number]: number } = {}): Gathering =>
    expiringAt({ 0: T + 50, 1: T + 50, 2: T + 50, 3: T + 50, ...expiries });

  it('the preferred set holds places 0, 1 and 2 when nothing has expired, as without the method', () => {
    const record = allFiled();

    expect(proofPlaces(clientWith(zkRegistry()).complete(record, undefined, T))).toEqual([0, 1, 2]);
    expect(clientWith(zkRegistry()).complete(record, undefined, T)).toStrictEqual(clientWith(new Map()).complete(record, undefined, T));
  });

  it('an expired place in the preferred set refuses with the expiry message and exactly that place\'s row', () => {
    const refusal = refusalOf(() => clientWith(zkRegistry()).complete(allFiled({ 1: T }), undefined, T));

    expect(refusal.message).toBe(GATHERING_PROOF_EXPIRED_MESSAGE);
    expect(refusal.findings?.warnings).toEqual([]);
    expect(refusal.findings?.errors.map(integral)).toEqual([expired(1, T, T)]);
  });

  it('two expired chosen places are both reported, in place order, and an expired place left out is not', () => {
    const refusal = refusalOf(() => clientWith(zkRegistry()).complete(allFiled({ 2: T - 10, 1: T - 20, 3: T - 30 }), undefined, T));

    expect(refusal.findings?.errors.map(integral)).toEqual([expired(1, T - 20, T), expired(2, T - 10, T)]);
  });

  it('a selection naming an expired place is refused the same way', () => {
    const refusal = refusalOf(() => clientWith(zkRegistry()).complete(allFiled({ 3: T }), [0, 1, 3], T));

    expect(refusal.message).toBe(GATHERING_PROOF_EXPIRED_MESSAGE);
    expect(refusal.findings?.errors.map(integral)).toEqual([expired(3, T, T)]);
  });

  it('a selection avoiding the expired place completes with it', () => {
    expect(proofPlaces(clientWith(zkRegistry()).complete(allFiled({ 1: T }), [0, 2, 3], T))).toEqual([0, 2, 3]);
  });

  it('an expired place outside the preferred set does not stop the completion', () => {
    expect(proofPlaces(clientWith(zkRegistry()).complete(allFiled({ 3: T }), undefined, T))).toEqual([0, 1, 2]);
  });

  it('one second before a chosen proof expires the completion goes through, and at its expiry it is refused', () => {
    const record = allFiled({ 1: T });

    expect(proofPlaces(clientWith(zkRegistry()).complete(record, undefined, T - 1))).toEqual([0, 1, 2]);
    expect(() => clientWith(zkRegistry()).complete(record, undefined, T)).toThrow(GATHERING_PROOF_EXPIRED_MESSAGE);
  });

  it('the ordering verdict refuses first: an unsatisfied rule with an expired proof is the rule\'s refusal', () => {
    const refusal = refusalOf(() => clientWith(zkRegistry()).complete(expiringAt({ 0: T }), undefined, T));

    expect(refusal.message).toBe(GATHERING_ORDER_REFUSAL_MESSAGES['rule-unsatisfied']);
  });

  it('a client without an aging codec completes the same record unchanged', () => {
    expect(proofPlaces(clientWith(new Map()).complete(allFiled({ 1: T }), undefined, T))).toEqual([0, 1, 2]);
    expect(proofPlaces(clientWith(new Map([[ZK, walletMethod()]])).complete(allFiled({ 1: T }), undefined, T))).toEqual([0, 1, 2]);
  });

  it('the expiry message tells the caller what to do', () => {
    expect(GATHERING_PROOF_EXPIRED_MESSAGE).toContain('a chosen proof has expired; ask its approver again or select other places');
  });
});

describe('complete consults the codecs of the chosen places alone', () => {
  it.each(MISCONFIGURED)('an unchosen place whose codec %s leaves the preferred set\'s completion as it is without that module', (_why, other) => {
    const record = mixedFiled([3]);

    expect(clientWith(mixedRegistry(other())).complete(record, undefined, T)).toStrictEqual(clientWith(zkRegistry()).complete(record, undefined, T));
  });

  it.each(MISCONFIGURED)('a selection leaving out a place whose codec %s completes with the places it names', (_why, other) => {
    expect(proofPlaces(clientWith(mixedRegistry(other())).complete(mixedFiled([1]), [0, 2, 3], T))).toEqual([0, 2, 3]);
  });

  it.each(MISCONFIGURED)('beside an unchosen place whose codec %s, an expired chosen proof is still the expiry refusal', (_why, other) => {
    const refusal = refusalOf(() => clientWith(mixedRegistry(other())).complete(mixedFiled([3], { 1: T }), undefined, T));

    expect(refusal.message).toBe(GATHERING_PROOF_EXPIRED_MESSAGE);
    expect(refusal.findings?.warnings).toEqual([]);
    expect(refusal.findings?.errors.map(integral)).toEqual([expired(1, T, T)]);
  });

  it.each(MISCONFIGURED)('assess on the same record still throws the TypeError for the place whose codec %s', (_why, other, tail) => {
    const error = thrown(() => clientWith(mixedRegistry(other())).assess(mixedFiled([3]), T));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(otherMessage(tail));
  });

  it.each(MISCONFIGURED)('a chosen place whose codec %s still makes complete throw that TypeError', (_why, other, tail) => {
    const error = thrown(() => clientWith(mixedRegistry(other())).complete(mixedFiled([3]), [0, 1, 3], T));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(otherMessage(tail));
  });

  it('never asks an unchosen place\'s codec for anything, even where its proof has expired', () => {
    const { method, asked } = recordingMethod();

    expect(proofPlaces(clientWith(mixedRegistry(method)).complete(mixedFiled([3], { 3: T }), undefined, T))).toEqual([0, 1, 2]);
    expect(asked).toEqual([]);
  });

  it('asks a chosen place\'s codec for its expiry, and refuses the expired place', () => {
    const { method, asked } = recordingMethod();
    const refusal = refusalOf(() => clientWith(mixedRegistry(method)).complete(mixedFiled([3], { 3: T }), [0, 1, 3], T));

    expect(refusal.findings?.errors.map(integral)).toEqual([expired(3, T, T)]);
    expect(asked).toContain('get proofExpiry');
  });

  it('assess still asks the codec of every filed place and reports the unchosen expired one', () => {
    const { method, asked } = recordingMethod();
    const findings = assessed(clientWith(mixedRegistry(method)), mixedFiled([3], { 3: T }), T);

    expect(findings).toEqual([expired(3, T, T), expiring(0, T + 50), expiring(1, T + 50), expiring(2, T + 50)]);
    expect(asked).toContain('get proofExpiry');
  });

  it.each([
    ['under the zkPassport module', []],
    ['under a second aging module', [3]],
  ] as const)('an expired proof %s left out of the preferred set does not refuse it, and a selection naming it does', (_why, others) => {
    const record = mixedFiled(others, { 3: T - 10 });
    const client = clientWith(mixedRegistry(zkPassportMethod({ stack: stackDouble().stack })));

    expect(proofPlaces(client.complete(record, undefined, T))).toEqual([0, 1, 2]);
    expect(refusalOf(() => client.complete(record, [0, 1, 3], T)).findings?.errors.map(integral)).toEqual([expired(3, T - 10, T)]);
    expect(assessed(client, record, T)[0]).toEqual(expired(3, T - 10, T));
  });
});

describe('the expiry hook stays method-blind', () => {
  it.each([
    ['wallet', () => walletMethod().codec],
    ['passkey', () => passkeyMethod().codec],
    ['Aadhaar', () => anonAadhaarMethod().codec],
  ])('the %s codec carries no proofExpiry', (_name, codecOf) => {
    expect('proofExpiry' in codecOf()).toBe(false);
  });

  it('the core entry exports the expiry message and no expiry helper of the gathering', () => {
    expect(Object.keys(core)).toContain('GATHERING_PROOF_EXPIRED_MESSAGE');
    expect(Object.keys(core).filter((name) => /^(?:proofExpiries|expiryFindings)$/.test(name))).toEqual([]);
  });

  it.each(['assess', 'complete'])('%s documents the proof expiry', (name) => {
    expect(jsDocOf(join(SRC_ROOT, 'recovery-client', 'client.ts'), name, 'RecoveryClient')).toMatch(/expir/);
  });
});

describe('the proof expiry\'s changeset', () => {
  const text = (): string => readFileSync(join(PACKAGE_ROOT, '..', '..', '.changeset', 'proof-expiry.md'), 'utf8');

  it('is a patch of the package naming the codec member and both codes, and never names the factory', () => {
    expect(text()).toMatch(/['"]@kohaku-eth\/social-recovery['"]\s*:\s*patch/);

    for (const name of ['proofExpiry', 'proof.expired', 'proof.expiring']) expect(text()).toContain(name);

    expect(text()).not.toContain('zkPassportMethod');
  });
});
