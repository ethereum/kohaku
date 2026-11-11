import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_PADDING_SIZE,
  KitRefusalError,
  passkeyMethod,
  SETUP_CLIENT_BACKUP_TOO_WIDE_MESSAGE,
  SETUP_CLIENT_VALIDATION_REFUSED_MESSAGE,
  SETUP_CLIENT_VERSION_ESCAPED_MESSAGE,
  walletMethod,
  type Address,
  type Hex,
  type IRecoveryMethod,
  type MethodRegistry,
  type PreparedBatch,
  type SetupDraft,
  type ValidationResult,
} from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  addressWord,
  answeringHandler,
  ARMING_DATA,
  BAD_DRAFT,
  build,
  type BuildOptions,
  CONFIGURATION,
  DESCRIPTOR,
  DRAFT,
  members,
  METHOD_A,
  METHOD_B,
  methodStub,
  OTHER_ACTION,
  PIN,
  pinnedPartCalls,
  position,
  referenceCommitment,
  type Seen,
  simulationCalls,
  transportFailure,
  withBackup,
} from './doubles';
import { bareArray, skippedAt, withSkipped } from '../helpers/fetched';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
const OTHER_MANAGER: Address = getAddress(`0x${'a9'.repeat(20)}`);

/** A handler address the account keeps under its fallback-handler slot, as one stored word. */
const HANDLER_WORD: Hex = `0x${'00'.repeat(12)}${'ab'.repeat(19)}69`;

/** One P-256 coordinate word. */
const word = (value: bigint): string => value.toString(16).padStart(64, '0');

/** The P-256 generator, a key on the curve. */
const GENERATOR = {
  x: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
  y: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
};

/** A passkey config of three words, the key's two coordinates and a relying-party hash. */
const passkeyConfig = (x: bigint, y: bigint): Hex => `0x${word(x)}${word(y)}${'cd'.repeat(32)}`;

/** A wallet config word, the address in its low 20 bytes. */
const WALLET_WORD: Hex = `0x${'00'.repeat(12)}${'ab'.repeat(20)}`;

const CLEAN = withBackup(DRAFT, 'empty');
const BAD = withBackup(BAD_DRAFT, 'empty');
const EMPTY_RULE: SetupDraft = { ...CLEAN, clauses: [] };
const LONG_WAIT: SetupDraft = { ...CLEAN, wait: CONFIGURATION.maxWait + 1 };
const WIDEST_WAIT: SetupDraft = { ...CLEAN, wait: 2 ** 48 - 1 };

/** A wallet credential and a passkey credential under the shipped codecs, the passkey key at the given point. */
const shippedDraft = (x: bigint, y: bigint): SetupDraft => ({
  ...CLEAN,
  clauses: [{ threshold: 1, credentials: [{ method: METHOD_A, config: WALLET_WORD }, { method: METHOD_B, config: passkeyConfig(x, y) }] }],
});

/** The shipped wallet and passkey methods registered for the two modules, so a passkey key off the curve is bounded. */
const shippedRegistry = (): MethodRegistry =>
  new Map<Address, IRecoveryMethod>([
    [METHOD_A, walletMethod()],
    [METHOD_B, passkeyMethod()],
  ]);

/** The stub registry with `METHOD_A`'s codec missing its `decodeConfig`. */
const undecodableRegistry = (): MethodRegistry =>
  new Map<Address, IRecoveryMethod>([
    [METHOD_A, { ...methodStub([METHOD_A]), codec: {} as IRecoveryMethod['codec'] }],
    [METHOD_B, methodStub([METHOD_B])],
  ]);

const WORLDS: readonly (readonly [string, BuildOptions])[] = [
  ['a deployed account', {}],
  ['a code-less account', { world: { code: '0x' } }],
  [
    'a code-less account whose configuration declares the served implementation',
    { world: { code: '0x' }, configuration: { accountImplementation: DESCRIPTOR.servedImplementation } },
  ],
  ['an action whose MANAGER() answers another manager', { world: { manager: addressWord(OTHER_MANAGER) } }],
  ['an action that does not serve the account', { world: { supportsAccount: false } }],
  ['a registered method stub without decodeConfig', { methods: undecodableRegistry() }],
];

const DRAFTS: readonly (readonly [string, SetupDraft])[] = [
  ['a clean draft', CLEAN],
  ['a threshold of 3 over 2 credentials', BAD],
  ['an empty rule', EMPTY_RULE],
  ['a wait above maxWait', LONG_WAIT],
  ['a wait past the field width', WIDEST_WAIT],
];

const ROWS: readonly (readonly [string, string, BuildOptions, SetupDraft])[] = [
  ...WORLDS.flatMap(([world, options]) => DRAFTS.map(([draft, value]) => [world, draft, options, value] as const)),
  ['the shipped codecs', 'a passkey key off the curve', { methods: shippedRegistry() }, shippedDraft(1n, 2n)],
  ['the shipped codecs', 'a passkey key on the curve', { methods: shippedRegistry() }, shippedDraft(GENERATOR.x, GENERATOR.y)],
];

/** A settled promise: the value it resolved with, or the error it rejected with. */
type Outcome<T> = { readonly value: T } | { readonly error: unknown };

const settle = <T>(promise: Promise<T>): Promise<Outcome<T>> =>
  promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

/** What a call ended in: a prepare, a refusal carrying findings, or another throw by its class and message. */
type Verdict =
  | { readonly prepares: true }
  | { readonly refuses: { readonly exact: boolean; readonly findings: unknown; readonly cause: boolean; readonly restoreCause: boolean } }
  | { readonly throws: { readonly kind: unknown; readonly message: string } };

const thrownVerdict = (error: unknown): Verdict => ({ throws: { kind: (error as Error).constructor, message: (error as Error).message } });

/** The verdict `validateSetup` implies for the prepare: refuse on an error, prepare otherwise, throw what it throws. */
const expectedVerdict = (judged: Outcome<ValidationResult>): Verdict => {
  if ('error' in judged) return thrownVerdict(judged.error);

  if (judged.value.errors.length === 0) return { prepares: true };

  return { refuses: { exact: true, findings: judged.value, cause: false, restoreCause: false } };
};

/** The verdict the prepare reached. */
const preparedVerdict = (prepared: Outcome<unknown>): Verdict => {
  if (!('error' in prepared)) return { prepares: true };

  const { error } = prepared;

  if (!(error instanceof KitRefusalError) || error.message !== SETUP_CLIENT_VALIDATION_REFUSED_MESSAGE) return thrownVerdict(error);

  return {
    refuses: {
      exact: error.constructor === KitRefusalError,
      findings: error.findings,
      cause: Object.hasOwn(error, 'cause'),
      restoreCause: 'restoreCause' in error,
    },
  };
};

/** Whether the prepare in the world refused, and the doubles' log of it. */
async function refusal(options: BuildOptions, draft: SetupDraft, password?: string): Promise<{ thrown: unknown; seen: Seen }> {
  const { client, seen } = build(options);
  const thrown = await client.prepareCommitSetup(draft, password).then(
    () => undefined,
    (error: unknown) => error,
  );

  return { thrown, seen };
}

/** Asserts the doubles saw one reading of one height: one block read, one code read, every pinned read at `PIN`. */
function expectOneHeight(seen: Seen): void {
  expect(seen.blockTags).toEqual(['latest']);
  expect(seen.codes).toEqual([{ address: ACCOUNT, block: PIN.number }]);

  for (const call of pinnedPartCalls(seen)) expect(call.args[call.args.length - 1], `${call.part}.${call.member}`).toEqual(PIN);

  for (const call of seen.calls) expect(call.block).toBe(PIN.number);

  for (const fetch of seen.fetches) expect(fetch.range.to).toBe(PIN.number);
}

/** Asserts the doubles saw nothing built: no arming, no commit, no simulation, only the zero-address validation reads. */
function expectNothingBuilt(seen: Seen): void {
  expect(members(seen)).not.toContain('action.armingCall');
  expect(members(seen)).not.toContain('manager.prepareCommitSetup');
  expect(simulationCalls(seen)).toEqual([]);
  expect(seen.calls.every((call) => call.from === ZERO_ADDRESS)).toBe(true);
  expect(members(seen).filter((member) => member === 'manager.stateOf').length).toBeLessThanOrEqual(1);
}

describe('prepareCommitSetup refuses exactly when validateSetup reports an error', () => {
  it.each(ROWS)('%s, %s', async (_world, _draft, options, draft) => {
    const judged = await settle(build(options).client.validateSetup(draft));
    const prepared = await settle(build(options).client.prepareCommitSetup(draft));

    expect(preparedVerdict(prepared)).toEqual(expectedVerdict(judged));
  });

  it('the table reaches every verdict: a clean prepare, a refusal and a judgment that throws', async () => {
    const verdicts = await Promise.all(ROWS.map(async ([, , options, draft]) => expectedVerdict(await settle(build(options).client.validateSetup(draft)))));
    const kinds = new Set(verdicts.map((verdict) => Object.keys(verdict)[0]));

    expect([...kinds].sort()).toEqual(['prepares', 'refuses', 'throws']);
  });

  it('carries the message SETUP_CLIENT_VALIDATION_REFUSED_MESSAGE names, exported from the core entry', () => {
    expect(SETUP_CLIENT_VALIDATION_REFUSED_MESSAGE).toBe('the setup draft does not validate: its findings name every error');
  });
});

const REFUSED: readonly (readonly [string, BuildOptions, SetupDraft, readonly string[]])[] = [
  ['a threshold of 3 over 2 credentials', {}, BAD, ['clause.threshold-above-count']],
  ['an empty rule', {}, EMPTY_RULE, ['rule.empty']],
  ['a wait above maxWait', {}, LONG_WAIT, ['wait.above-maximum']],
  ['a wait past the field width', {}, WIDEST_WAIT, ['wait.field-width', 'wait.above-maximum']],
  ['a code-less account', { world: { code: '0x' } }, CLEAN, ['account.not-deployed']],
  ['an action whose MANAGER() answers another manager', { world: { manager: addressWord(OTHER_MANAGER) } }, CLEAN, ['action.manager-mismatch']],
  ['an action that does not serve the account', { world: { supportsAccount: false } }, CLEAN, ['action.unsupported']],
  ['a passkey key off the curve', { methods: shippedRegistry() }, shippedDraft(1n, 2n), ['credential.config-malformed']],
];

describe('a refused prepare builds nothing', () => {
  it.each(REFUSED)('%s: a KitRefusalError carrying the errors, after the validation reads alone', async (_name, options, draft, codes) => {
    const { thrown, seen } = await refusal(options, draft);

    expect((thrown as object).constructor).toBe(KitRefusalError);
    expect((thrown as KitRefusalError).message).toBe(SETUP_CLIENT_VALIDATION_REFUSED_MESSAGE);
    expect((thrown as KitRefusalError).findings?.errors.map((finding) => finding.code)).toEqual(codes);
    expectNothingBuilt(seen);
  });

  it('refuses an encrypted draft before sealing, the password checked and unused', async () => {
    const { thrown, seen } = await refusal({}, BAD_DRAFT, 'correct horse battery staple');

    expect((thrown as KitRefusalError).message).toBe(SETUP_CLIENT_VALIDATION_REFUSED_MESSAGE);
    expectNothingBuilt(seen);
  });
});

describe('one height per prepare', () => {
  it.each(REFUSED)('a refusal over %s reads one block and the account code once, every read at the pin', async (_name, options, draft) => {
    expectOneHeight((await refusal(options, draft)).seen);
  });

  it.each<[string, BuildOptions]>([
    ['a first commit', {}],
    ['an authorized account', { world: { authorized: true } }],
    ['an installed fallback handler', { world: { simulate: answeringHandler(HANDLER_WORD) } }],
  ])('a prepare over %s reads one block and the account code once, every read at the pin', async (_name, options) => {
    const { client, seen } = build(options);

    await client.prepareCommitSetup(CLEAN);
    expectOneHeight(seen);
  });
});

describe('a warning never blocks the prepare', () => {
  it.each<[string, BuildOptions, SetupDraft]>([
    ['backup.clear', {}, withBackup(DRAFT, 'clear')],
    ['backup.empty', {}, CLEAN],
    ['action.unaudited', { action: OTHER_ACTION }, CLEAN],
    ['account.fallback-handler', { world: { simulate: answeringHandler(HANDLER_WORD) } }, CLEAN],
  ])('%s: validateSetup reports no error and the prepare returns the simulated first-commit batch', async (code, options, draft) => {
    const judged = await build(options).client.validateSetup(draft);

    expect(judged.errors).toEqual([]);
    expect(judged.warnings.map((warning) => warning.code)).toContain(code);

    const { client, seen } = build(options);
    const prepared = (await client.prepareCommitSetup(draft)) as PreparedBatch;
    const commit = seen.parts.find((part) => part.member === 'prepareCommitSetup');

    expect(prepared.kind).toBe('batch');
    expect(prepared.calls[0]?.data).toBe(ARMING_DATA);
    expect(prepared.calls.map((call) => call.simulation)).toEqual([{ success: true }, { success: true }]);
    expect(commit?.args[1]).toBe(referenceCommitment(draft, ACCOUNT, options.action ?? ACTION, 1n));
  });
});

describe('a failed validation read', () => {
  it.each<[string, (failure: Error) => BuildOptions]>([
    ['the account-wide log fetch', (failure) => ({ world: { allActions: { rejects: failure } } })],
    ["the action's MANAGER() read", (failure) => ({ world: { manager: { rejects: failure } } })],
    ['the account code read', (failure) => ({ world: { code: { rejects: failure } } })],
  ])('rejects the prepare with a transport failure of %s as itself, as validateSetup does', async (_name, optionsFor) => {
    const failure = transportFailure();

    await expect(build(optionsFor(failure)).client.validateSetup(CLEAN)).rejects.toBe(failure);

    const { thrown, seen } = await refusal(optionsFor(failure), CLEAN);

    expect(thrown).toBe(failure);
    expect(members(seen)).not.toContain('action.armingCall');
    expect(members(seen)).not.toContain('manager.prepareCommitSetup');
    expect(simulationCalls(seen)).toEqual([]);
  });
});

describe('a validation read that skipped a log', () => {
  it('rejects the prepare with the skipped entry\'s error itself, as validateSetup does, building nothing', async () => {
    const failure = new Error('undecodable log');
    const options: BuildOptions = { world: { fetched: withSkipped(skippedAt(position(200), failure)) } };

    await expect(build(options).client.validateSetup(CLEAN)).rejects.toBe(failure);

    const { thrown, seen } = await refusal(options, CLEAN);

    expect(thrown).toBe(failure);
    expect(members(seen)).not.toContain('action.armingCall');
    expect(members(seen)).not.toContain('manager.prepareCommitSetup');
    expect(simulationCalls(seen)).toEqual([]);
  });

  it('rejects the prepare with a TypeError where the event manager answers a bare array, building nothing', async () => {
    const options: BuildOptions = { world: { fetched: bareArray } };

    await expect(build(options).client.validateSetup(CLEAN)).rejects.toThrow(TypeError);

    const { thrown, seen } = await refusal(options, CLEAN);

    expect(thrown).toBeInstanceOf(TypeError);
    expect(members(seen)).not.toContain('action.armingCall');
    expect(members(seen)).not.toContain('manager.prepareCommitSetup');
    expect(simulationCalls(seen)).toEqual([]);
  });
});

/** A draft whose serialized configuration is wider than the backup padding. */
const WIDE_DRAFT: SetupDraft = {
  ...DRAFT,
  clauses: [
    {
      threshold: 1,
      credentials: Array.from({ length: 4 }, (_, index) => ({
        method: index % 2 === 0 ? METHOD_A : METHOD_B,
        config: `0x${index.toString(16).padStart(2, '0').repeat(BACKUP_PADDING_SIZE / 4)}` as Hex,
      })),
    },
  ],
};

describe('the refusals before the pin stay ahead of validation, on a code-less account validation would refuse', () => {
  const CODELESS: BuildOptions = { world: { code: '0x' } };

  it('the version escape refuses with its own message and no findings, making no provider call', async () => {
    const { thrown, seen } = await refusal({ ...CODELESS, escaped: true }, DRAFT, 'pw');

    expect((thrown as KitRefusalError).message).toBe(SETUP_CLIENT_VERSION_ESCAPED_MESSAGE);
    expect((thrown as KitRefusalError).findings).toBeUndefined();
    expect(seen.provider).toEqual([]);
    expect(seen.parts).toEqual([]);
  });

  it('an encrypted backup too wide to seal refuses with its one backup.too-wide finding, making no provider call', async () => {
    const { thrown, seen } = await refusal(CODELESS, WIDE_DRAFT, 'pw');

    expect((thrown as object).constructor).toBe(KitRefusalError);
    expect((thrown as KitRefusalError).message).toBe(SETUP_CLIENT_BACKUP_TOO_WIDE_MESSAGE);
    expect((thrown as KitRefusalError).findings?.errors.map((finding) => finding.code)).toEqual(['backup.too-wide']);
    expect((thrown as KitRefusalError).findings?.warnings).toEqual([]);
    expect(seen.provider).toEqual([]);
    expect(seen.parts).toEqual([]);
  });

  it('a threshold past its field refuses with a RangeError, making no provider call', async () => {
    const draft: SetupDraft = { ...BAD, clauses: [{ threshold: 256, credentials: DRAFT.clauses[0]?.credentials ?? [] }] };
    const { thrown, seen } = await refusal(CODELESS, draft);

    expect(thrown).toBeInstanceOf(RangeError);
    expect(seen.provider).toEqual([]);
    expect(seen.parts).toEqual([]);
  });
});
