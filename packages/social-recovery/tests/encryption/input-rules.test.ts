import { describe, expect, it, vi } from 'vitest';
import {
  BACKUP_PADDING_SIZE,
  deserializeConfiguration,
  openBackup,
  sealBackup,
  serializeConfiguration,
  type BackupAuthenticated,
  type Configuration,
  type Credential,
  type Hex,
} from '../../src/index';
import { AUTHENTICATED, METHOD_WALLET, MIXED_RULE, NONCE, oneCredentialRule, PASSWORD, WALLET_CONFIG_WORD } from './samples';

/** Any 2501-byte hex, for refusals that must come before the payload is read. */
const ANY_PAYLOAD: Hex = `0x${'00'.repeat(12 + BACKUP_PADDING_SIZE + 16)}`;

const wallet = (method: Hex, extra: Partial<Credential> = {}): Credential => ({ method, config: WALLET_CONFIG_WORD, ...extra });

/** The error `run` throws; fails the test when it returns. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  throw new Error('expected a throw');
}

/** The error `attempt` rejects with; fails the test when it resolves. */
async function failure(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt;
  } catch (error) {
    return error;
  }

  throw new Error('expected the attempt to fail');
}

/** Asserts the error's class and that its message starts with the field path. */
function expectNamed(error: unknown, kind: typeof TypeError | typeof RangeError, path: string): void {
  expect(error).toBeInstanceOf(kind);
  expect((error as Error).message.startsWith(`${path} `)).toBe(true);
}

/** Counts the two WebCrypto calls the key derivation makes; restored by vi.restoreAllMocks. */
function spyOnDerivation(): () => number {
  const importKey = vi.spyOn(globalThis.crypto.subtle, 'importKey');
  const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');

  return () => importKey.mock.calls.length + deriveKey.mock.calls.length;
}

const base = oneCredentialRule(wallet(METHOD_WALLET));
const clause = (patch: Record<string, unknown>): Configuration =>
  ({ ...base, clauses: [{ threshold: 1, credentials: [wallet(METHOD_WALLET)], ...patch }] }) as unknown as Configuration;

describe('an integer field refuses a non-integer as a TypeError and an out-of-width integer as a RangeError', () => {
  it.for([
    ['a fractional wait', { ...base, wait: 1.5 }, TypeError, 'configuration.wait'],
    ['a NaN wait', { ...base, wait: Number.NaN }, TypeError, 'configuration.wait'],
    ['an infinite wait', { ...base, wait: Number.POSITIVE_INFINITY }, TypeError, 'configuration.wait'],
    ['a string wait', { ...base, wait: '60' }, TypeError, 'configuration.wait'],
    ['a bigint wait', { ...base, wait: 60n }, TypeError, 'configuration.wait'],
    ['a negative wait', { ...base, wait: -1 }, RangeError, 'configuration.wait'],
    ['a wait of 2^48', { ...base, wait: 2 ** 48 }, RangeError, 'configuration.wait'],
    ['a fractional threshold', clause({ threshold: 0.5 }), TypeError, 'configuration.clauses[0].threshold'],
    ['a string threshold', clause({ threshold: '1' }), TypeError, 'configuration.clauses[0].threshold'],
    ['a missing threshold', clause({ threshold: undefined }), TypeError, 'configuration.clauses[0].threshold'],
    ['a negative threshold', clause({ threshold: -1 }), RangeError, 'configuration.clauses[0].threshold'],
    ['a threshold of 256', clause({ threshold: 256 }), RangeError, 'configuration.clauses[0].threshold'],
    ['65,536 clauses', { ...base, clauses: new Array(65_536) }, RangeError, 'configuration.clauses count'],
    ['65,536 credentials', clause({ credentials: new Array(65_536) }), RangeError, 'configuration.clauses[0].credentials count'],
    ['a config of 65,536 bytes', oneCredentialRule(wallet(METHOD_WALLET, { config: `0x${'00'.repeat(65_536)}` })), RangeError,
      'configuration.clauses[0].credentials[0].config length'],
    ['clauses that are not an array', { ...base, clauses: {} }, TypeError, 'configuration.clauses'],
  ] as const)('refuses %s, naming the field', ([, configuration, kind, path]) => {
    expectNamed(thrown(() => serializeConfiguration(configuration as unknown as Configuration)), kind, path);
  });

  it('refuses a fractional wait from sealBackup as a TypeError before any key derivation', async () => {
    const derivations = spyOnDerivation();
    const error = await failure(sealBackup({ ...base, wait: 0.5 }, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));

    expectNamed(error, TypeError, 'configuration.wait');
    expect(derivations()).toBe(0);
    vi.restoreAllMocks();
  });
});

describe('a null object is a TypeError naming its path, before any member of a sibling is read', () => {
  it.for([
    ['a null configuration', null, 'configuration'],
    ['a null clause', { ...base, clauses: [null] }, 'configuration.clauses[0]'],
    ['an undefined clause after a valid one', { ...base, clauses: [base.clauses[0], undefined] }, 'configuration.clauses[1]'],
    ['a null credential', clause({ credentials: [wallet(METHOD_WALLET), null] }), 'configuration.clauses[0].credentials[1]'],
    ['a numeric credential', clause({ credentials: [7] }), 'configuration.clauses[0].credentials[0]'],
    ['a hole in a sparse clauses array', { ...base, clauses: new Array(1) }, 'configuration.clauses[0]'],
    ['a hole in a sparse credentials array', clause({ credentials: new Array(1) }), 'configuration.clauses[0].credentials[0]'],
  ] as const)('refuses %s', ([, configuration, path]) => {
    const error = thrown(() => serializeConfiguration(configuration as unknown as Configuration));

    expectNamed(error, TypeError, path);
    expect((error as TypeError).message).toBe(`${path} must be an object`);
  });

  it('checks every element of an array before reading a member of the first', () => {
    let reads = 0;
    const touch = <T>(value: T): T => {
      reads += 1;

      return value;
    };
    const watched = { get threshold() { return touch(1); }, get credentials() { return touch([]); } };
    const credential = { get method() { return touch(METHOD_WALLET); }, get config() { return touch('0x'); } };

    expectNamed(thrown(() => serializeConfiguration({ ...base, clauses: [watched, null] } as unknown as Configuration)),
      TypeError, 'configuration.clauses[1]');
    expectNamed(thrown(() => serializeConfiguration(clause({ credentials: [credential, null] }))),
      TypeError, 'configuration.clauses[0].credentials[1]');
    expect(reads).toBe(0);
  });

  it('refuses a null configuration and a null authenticated from sealBackup and openBackup before any key derivation', async () => {
    const derivations = spyOnDerivation();
    const none = null as unknown as BackupAuthenticated;

    expectNamed(await failure(sealBackup(null as unknown as Configuration, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED)),
      TypeError, 'configuration');
    expectNamed(await failure(sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, none)), TypeError, 'authenticated');
    expectNamed(await failure(openBackup(ANY_PAYLOAD, PASSWORD, none)), TypeError, 'authenticated');
    expect(derivations()).toBe(0);
    vi.restoreAllMocks();
  });
});

describe('the authenticated values keep their refusals, split by class', () => {
  it.for([
    ['a nonce given as a number', { nonce: 7 }, TypeError, 'authenticated.nonce'],
    ['a nonce of 2^64', { nonce: 2n ** 64n }, RangeError, 'authenticated.nonce'],
    ['a negative nonce', { nonce: -1n }, RangeError, 'authenticated.nonce'],
    ['a fractional payload version', { payloadVersion: 1.5 }, TypeError, 'authenticated.payloadVersion'],
    ['a bigint payload version', { payloadVersion: 1n }, TypeError, 'authenticated.payloadVersion'],
    ['a negative payload version', { payloadVersion: -1 }, RangeError, 'authenticated.payloadVersion'],
    ['a payload version past the safe integers', { payloadVersion: 2 ** 53 }, RangeError, 'authenticated.payloadVersion'],
    ['a 31-byte setup commitment', { setupCommitment: `0x${'ab'.repeat(31)}` }, TypeError, 'authenticated.setupCommitment'],
    ['a 19-byte account', { account: `0x${'11'.repeat(19)}` }, TypeError, 'authenticated.account'],
    ['an action without its prefix', { action: '22'.repeat(20) }, TypeError, 'authenticated.action'],
  ] as const)('refuses %s from openBackup, naming the field', async ([, patch, kind, path]) => {
    const authenticated = { ...AUTHENTICATED, ...patch } as unknown as BackupAuthenticated;

    expectNamed(await failure(openBackup(ANY_PAYLOAD, PASSWORD, authenticated)), kind, path);
  });

  it.for([
    ['a payload that is not hex', '0xzz', 'payload'],
    ['a payload of an odd digit count', '0x0', 'payload'],
    ['a payload without its prefix', '00'.repeat(2501), 'payload'],
  ] as const)('refuses %s as a TypeError naming it', async ([, payload, path]) => {
    expectNamed(await failure(openBackup(payload as Hex, PASSWORD, AUTHENTICATED)), TypeError, path);
  });

  it.for([
    ['a config that is not hex', { config: '0xzz' }, 'configuration.clauses[0].credentials[0].config'],
    ['a config of an odd digit count', { config: '0xabc' }, 'configuration.clauses[0].credentials[0].config'],
    ['a 31-byte salt', { salt: `0x${'00'.repeat(31)}` }, 'configuration.clauses[0].credentials[0].salt'],
    ['a null salt', { salt: null }, 'configuration.clauses[0].credentials[0].salt'],
  ] as const)('refuses %s as a TypeError naming it', ([, patch, path]) => {
    const configuration = oneCredentialRule(wallet(METHOD_WALLET, patch as unknown as Partial<Credential>));

    expectNamed(thrown(() => serializeConfiguration(configuration)), TypeError, path);
  });

  it('refuses a serialized configuration that is not hex as a TypeError naming it', () => {
    expectNamed(thrown(() => deserializeConfiguration('0x0' as Hex)), TypeError, 'serialized configuration');
  });
});
