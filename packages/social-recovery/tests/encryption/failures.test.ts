import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_PADDING_SIZE,
  BACKUP_PAYLOAD_VERSION,
  BackupTooWideError,
  BackupUnopenedError,
  openBackup,
  sealBackup,
  serializeConfiguration,
  type BackupAuthenticated,
  type Configuration,
  type Hex,
} from '../../src/index';
import {
  AUTHENTICATED,
  byteLength,
  flipByte,
  METHOD_WALLET,
  METHOD_ZKPASSPORT,
  MIXED_RULE,
  NONCE,
  passkeyClausesRule,
  passkeyRule,
  PASSWORD,
  ZKPASSPORT_CONFIG_BLESSED,
} from './samples';
import {
  referenceAssociatedData,
  referenceKey,
  referenceOpenRaw,
  referenceSealRaw,
  referenceSerialize,
  toBytes,
  toHex,
} from './reference';

const TIMEOUT = 60_000;
const PAYLOAD_SIZE = 12 + BACKUP_PADDING_SIZE + 16;

let payload: Hex;
let canonical: BackupUnopenedError;

/** Every BackupUnopenedError message this file observes; the last test asserts one distinct value. */
const unopenedMessages: string[] = [];
/** Every BackupTooWideError this file observes; the last test asserts each reports 2473. */
const tooWide: BackupTooWideError[] = [];

/** Resolves to the error the attempt rejects with; throws when it resolves. */
async function failure(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt;
  } catch (error) {
    return error;
  }

  throw new Error('expected the attempt to fail');
}

/** Asserts the error is the one unopened failure, indistinguishable from a wrong password. */
function expectUnopened(error: unknown, size: number): void {
  expect(error).toBeInstanceOf(BackupUnopenedError);
  expect(error).not.toBeInstanceOf(BackupTooWideError);

  const unopened = error as BackupUnopenedError;

  unopenedMessages.push(unopened.message);
  expect(unopened.name).toBe(canonical.name);
  expect(unopened.message).toBe(canonical.message);
  expect(unopened.payloadSize).toBe(size);
}

beforeAll(async () => {
  payload = await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED);

  const error = await failure(openBackup(payload, `${PASSWORD} `, AUTHENTICATED));

  if (!(error instanceof BackupUnopenedError)) throw new Error('a wrong password must raise BackupUnopenedError');

  canonical = error;
  unopenedMessages.push(error.message);
}, TIMEOUT);

describe('a wrong password', () => {
  it('fails as the one unopened failure carrying the payload size', () => {
    expect(canonical.payloadSize).toBe(PAYLOAD_SIZE);
    expect(canonical.name).toBe('BackupUnopenedError');
    expect(canonical.message.length).toBeGreaterThan(0);
  });

  it.for([
    ['the empty password', ''],
    ['the password in another case', PASSWORD.toUpperCase()],
    ['the password with a trailing newline', `${PASSWORD}\n`],
  ] as const)('fails under %s', { timeout: TIMEOUT }, async ([, password]) => {
    expectUnopened(await failure(openBackup(payload, password, AUTHENTICATED)), PAYLOAD_SIZE);
  });
});

const POSITIONS: ReadonlyArray<readonly [string, number]> = [
  ['nonce, first byte', 0],
  ['nonce, last byte', 11],
  ['ciphertext, first byte (the serialization)', 12],
  ['ciphertext, a byte inside a config', 12 + 60],
  ['ciphertext, a padding byte', 12 + 2000],
  ['ciphertext, last byte', 12 + BACKUP_PADDING_SIZE - 1],
  ['tag, first byte', 12 + BACKUP_PADDING_SIZE],
  ['tag, last byte', PAYLOAD_SIZE - 1],
];

describe('damaged bytes', () => {
  it.for(POSITIONS)('fails with one byte flipped at the %s', { timeout: TIMEOUT }, async ([, position]) => {
    expectUnopened(await failure(openBackup(flipByte(payload, position), PASSWORD, AUTHENTICATED)), PAYLOAD_SIZE);
  });

  it('fails with a single low bit flipped', async () => {
    expectUnopened(await failure(openBackup(flipByte(payload, 12 + 5, 0x01), PASSWORD, AUTHENTICATED)), PAYLOAD_SIZE);
  }, TIMEOUT);

  it.for([
    ['the last byte dropped', (hex: Hex): Hex => hex.slice(0, -2) as Hex],
    ['one byte appended', (hex: Hex): Hex => `${hex}00`],
    ['the tag dropped', (hex: Hex): Hex => hex.slice(0, -32) as Hex],
    ['only the nonce and tag left', (hex: Hex): Hex => `${hex.slice(0, 26)}${hex.slice(-32)}` as Hex],
    ['nothing left', (): Hex => '0x'],
  ] as const)('fails with %s', { timeout: TIMEOUT }, async ([, damage]) => {
    const damaged = damage(payload);

    expectUnopened(await failure(openBackup(damaged, PASSWORD, AUTHENTICATED)), byteLength(damaged));
  });
});

const FOREIGN: ReadonlyArray<readonly [string, BackupAuthenticated]> = [
  ['account', { ...AUTHENTICATED, account: '0x3333333333333333333333333333333333333333' }],
  ['action', { ...AUTHENTICATED, action: '0x3333333333333333333333333333333333333333' }],
  ['account and action swapped', { ...AUTHENTICATED, account: AUTHENTICATED.action, action: AUTHENTICATED.account }],
  ['setup commitment', { ...AUTHENTICATED, setupCommitment: `${AUTHENTICATED.setupCommitment.slice(0, -2)}7a` as Hex }],
  ['setup nonce, the next one', { ...AUTHENTICATED, nonce: AUTHENTICATED.nonce + 1n }],
  ['setup nonce, zero', { ...AUTHENTICATED, nonce: 0n }],
  ['payload version, the next one', { ...AUTHENTICATED, payloadVersion: BACKUP_PAYLOAD_VERSION + 1 }],
  ['payload version, zero', { ...AUTHENTICATED, payloadVersion: 0 }],
];

describe('a foreign authenticated value, each of the five', () => {
  it.for(FOREIGN)('fails when the %s differs', { timeout: TIMEOUT }, async ([, foreign]) => {
    expectUnopened(await failure(openBackup(payload, PASSWORD, foreign)), PAYLOAD_SIZE);
  });

  it('opens under an upper-case spelling of the same commitment (hex case is not a value)', async () => {
    const upper: BackupAuthenticated = {
      ...AUTHENTICATED,
      setupCommitment: AUTHENTICATED.setupCommitment.toUpperCase().replace('0X', '0x') as Hex,
    };

    await expect(openBackup(payload, PASSWORD, upper)).resolves.toBeDefined();
  }, TIMEOUT);
});

describe('a payload of another version', () => {
  it('fails when a payload sealed under another version is opened under this build\'s version', async () => {
    const other = await sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, {
      ...AUTHENTICATED,
      payloadVersion: BACKUP_PAYLOAD_VERSION + 1,
    });

    expect(byteLength(other)).toBe(PAYLOAD_SIZE);
    expectUnopened(await failure(openBackup(other, PASSWORD, AUTHENTICATED)), PAYLOAD_SIZE);
  }, TIMEOUT);
});

describe('a plaintext beyond the padding is refused', () => {
  const refused = async (configuration: Configuration): Promise<BackupTooWideError> => {
    const error = await failure(sealBackup(configuration, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));

    expect(error).toBeInstanceOf(BackupTooWideError);
    expect(error).not.toBeInstanceOf(BackupUnopenedError);
    tooWide.push(error as BackupTooWideError);

    return error as BackupTooWideError;
  };

  it('refuses a seventeenth salted passkey (one clause of 17, 2579 bytes against 2473)', async () => {
    const error = await refused(passkeyRule(17, true));

    expect(error.name).toBe('BackupTooWideError');
    expect(error.plaintextSize).toBe(9 + 3 + 17 * 151);
    expect(error.plaintextSize).toBe(2579);
    expect(error.paddingSize).toBe(BACKUP_PADDING_SIZE);
  });

  it('refuses a serialization one byte past the padding (2474)', async () => {
    // the 2473-byte worst case with the last config one byte wider
    const error = await refused(passkeyClausesRule(16, 1));

    expect(error.plaintextSize).toBe(2474);
    expect(error.plaintextSize).toBe(BACKUP_PADDING_SIZE + 1);
    expect(error.paddingSize).toBe(2473);
  });

  it('refuses the 16-credential worst case plus an empty clause (2476; setup validation, not the sealer, owns empty clauses)', async () => {
    const worst = passkeyClausesRule(16);
    const error = await refused({ ...worst, clauses: [...worst.clauses, { threshold: 0, credentials: [] }] });

    expect(error.plaintextSize).toBe(BACKUP_PADDING_SIZE + 3);
  });

  it('refuses eight credentials at the blessed zkPassport width', async () => {
    const credentials = Array.from({ length: 8 }, () => ({ method: METHOD_ZKPASSPORT, config: ZKPASSPORT_CONFIG_BLESSED }));
    const error = await refused({ clauses: [{ threshold: 1, credentials }], wait: 60, ignoresPause: false });

    expect(error.plaintextSize).toBe(9 + 3 + 8 * (20 + 2 + 288 + 1));
  });

});

/** Spies on the two WebCrypto calls the key derivation makes; restored by vi.restoreAllMocks. */
function spyOnDerivation(): { readonly calls: () => number } {
  const subtle = globalThis.crypto.subtle;
  const importKey = vi.spyOn(subtle, 'importKey');
  const deriveKey = vi.spyOn(subtle, 'deriveKey');

  return { calls: () => importKey.mock.calls.length + deriveKey.mock.calls.length };
}

describe('a padding other than the shipped one is refused (no integrator overrides)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.for([
    ['smaller (64)', MIXED_RULE, 64],
    ['smaller by one (2472)', MIXED_RULE, BACKUP_PADDING_SIZE - 1],
    ['larger by one (2474)', MIXED_RULE, BACKUP_PADDING_SIZE + 1],
    ['larger (4096)', MIXED_RULE, 4096],
    ['the serialization\'s exact length', MIXED_RULE, -1],
    ['zero', MIXED_RULE, 0],
    ['negative', MIXED_RULE, -2473],
    ['fractional', MIXED_RULE, BACKUP_PADDING_SIZE + 0.5],
    ['NaN', MIXED_RULE, Number.NaN],
    // a configuration too wide for 2473, offered a padding that would hold it
    ['4096 under an oversized configuration (17 salted passkeys, 2579)', passkeyRule(17, true), 4096],
    ['the oversized configuration\'s exact length (2579)', passkeyRule(17, true), -1],
  ] as const)('refuses a padding %s with a RangeError, no too-wide error, no payload and no key derived', async ([, configuration, size]) => {
    const paddingSize = size === -1 ? byteLength(serializeConfiguration(configuration)) : size;
    const derivation = spyOnDerivation();
    let produced: Hex | undefined;
    let error: unknown;

    try {
      produced = await sealBackup(configuration, PASSWORD, NONCE, paddingSize, AUTHENTICATED);
    } catch (caught) {
      error = caught;
    }

    expect(produced).toBeUndefined();
    expect(error).toBeInstanceOf(RangeError);
    expect(error).not.toBeInstanceOf(BackupTooWideError);
    expect(error).not.toBeInstanceOf(BackupUnopenedError);
    expect(derivation.calls()).toBe(0);
  });

  it('refuses the oversized configuration under the shipped padding as too wide, reporting 2473', async () => {
    const error = await failure(sealBackup(passkeyRule(17, true), PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));

    expect(error).toBeInstanceOf(BackupTooWideError);
    tooWide.push(error as BackupTooWideError);
    expect((error as BackupTooWideError).paddingSize).toBe(2473);
  });
});

describe('a payload of any length but 2501 is refused before the key is derived', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // PBKDF2 at 600,000 iterations takes far longer than this; the derivation spy is the primary check.
  const WRONG_LENGTH_BOUND_MS = 20;

  it.for([
    ['2500 bytes (the last byte dropped)', (hex: Hex): Hex => hex.slice(0, -2) as Hex, 2500],
    ['2502 bytes (one byte appended)', (hex: Hex): Hex => `${hex}00`, 2502],
    ['0 bytes (empty)', (): Hex => '0x', 0],
    ['28 bytes (nonce and tag only)', (hex: Hex): Hex => `${hex.slice(0, 26)}${hex.slice(-32)}` as Hex, 28],
    ['5002 bytes (the payload twice)', (hex: Hex): Hex => `${hex}${hex.slice(2)}` as Hex, 5002],
  ] as const)('refuses %s as the one unopened failure, with no key derived and fast', async ([, reshape, size]) => {
    const reshaped = reshape(payload);

    expect(byteLength(reshaped)).toBe(size);

    const derivation = spyOnDerivation();
    let fastest = Number.POSITIVE_INFINITY;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = performance.now();
      const error = await failure(openBackup(reshaped, PASSWORD, AUTHENTICATED));

      fastest = Math.min(fastest, performance.now() - started);
      expectUnopened(error, size);
    }

    expect(derivation.calls()).toBe(0);
    expect(fastest).toBeLessThan(WRONG_LENGTH_BOUND_MS);
  });

  it('does derive the key for a payload of the right length (the spy sees derivation when it happens)', async () => {
    const derivation = spyOnDerivation();
    const started = performance.now();

    expectUnopened(await failure(openBackup(payload, `${PASSWORD}?`, AUTHENTICATED)), PAYLOAD_SIZE);

    const elapsed = performance.now() - started;

    expect(derivation.calls()).toBeGreaterThan(0);
    expect(elapsed).toBeGreaterThan(WRONG_LENGTH_BOUND_MS);
  }, TIMEOUT);
});

describe('an authenticated payload whose plaintext is not a configuration', () => {
  /** Seals with the node:crypto reference, since only a sealer holding the key can authenticate such a plaintext. */
  const sealPlaintext = (plaintext: Buffer): Hex => {
    const associatedData = referenceAssociatedData(AUTHENTICATED);
    const key = referenceKey(PASSWORD, associatedData);
    const sealed = referenceSealRaw(key, toBytes(NONCE), associatedData, plaintext);

    expect(referenceOpenRaw(key, sealed, associatedData).equals(plaintext)).toBe(true);

    return toHex(sealed);
  };

  it.for([
    ['all 0xff bytes', (): Buffer => Buffer.alloc(BACKUP_PADDING_SIZE, 0xff)],
    ['a valid serialization followed by a nonzero padding byte', (): Buffer => {
      const plaintext = Buffer.alloc(BACKUP_PADDING_SIZE);

      referenceSerialize(MIXED_RULE).copy(plaintext);
      plaintext[BACKUP_PADDING_SIZE - 1] = 0x01;

      return plaintext;
    }],
    ['a serialization that claims more clauses than it carries', (): Buffer => {
      const plaintext = Buffer.alloc(BACKUP_PADDING_SIZE);

      referenceSerialize(MIXED_RULE).copy(plaintext);
      plaintext.writeUInt16BE(0xffff, 7);

      return plaintext;
    }],
  ] as const)('fails as the one unopened failure when the plaintext is %s', { timeout: TIMEOUT }, async ([, plaintext]) => {
    const sealed = sealPlaintext(plaintext());

    expect(byteLength(sealed)).toBe(PAYLOAD_SIZE);
    expectUnopened(await failure(openBackup(sealed, PASSWORD, AUTHENTICATED)), PAYLOAD_SIZE);
  });
});

describe('caller mistakes are not the unopened failure', () => {
  it.for([
    ['a nonce of 11 bytes', (): Promise<unknown> => sealBackup(MIXED_RULE, PASSWORD, '0x0001020304050607080910', BACKUP_PADDING_SIZE, AUTHENTICATED)],
    ['an account of 19 bytes', (): Promise<unknown> =>
      openBackup(payload, PASSWORD, { ...AUTHENTICATED, account: `0x${'11'.repeat(19)}` })],
    ['a setup nonce past uint64', (): Promise<unknown> => openBackup(payload, PASSWORD, { ...AUTHENTICATED, nonce: 2n ** 64n })],
    ['a payload that is not hex', (): Promise<unknown> => openBackup('0xzz' as Hex, PASSWORD, AUTHENTICATED)],
    ['a salt of 31 bytes', (): Promise<unknown> =>
      sealBackup({ clauses: [{ threshold: 1, credentials: [{ method: METHOD_WALLET, config: '0x', salt: `0x${'00'.repeat(31)}` }] }], wait: 0, ignoresPause: false },
        PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED)],
  ] as const)('refuses %s with a TypeError or RangeError', async ([, attempt]) => {
    const error = await failure(attempt());

    expect(error instanceof TypeError || error instanceof RangeError).toBe(true);
    expect(error).not.toBeInstanceOf(BackupUnopenedError);
  });
});

describe('without WebCrypto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses to seal rather than fall back to anything else', async () => {
    vi.stubGlobal('crypto', undefined);

    await expect(sealBackup(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED)).rejects.toThrow(/WebCrypto/);
  });
});

describe('across this suite', () => {
  // Must stay last: it reads the errors every test above recorded.
  it('every BackupUnopenedError carried the one identical message', () => {
    expect(unopenedMessages.length).toBeGreaterThan(30);
    expect([...new Set(unopenedMessages)]).toEqual([canonical.message]);
  });

  it('every BackupTooWideError reported the shipped padding, 2473', () => {
    expect(tooWide.length).toBeGreaterThanOrEqual(5);
    expect(tooWide.every((error) => error.paddingSize === 2473)).toBe(true);
  });
});
