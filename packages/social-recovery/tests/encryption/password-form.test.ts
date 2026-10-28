import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_PADDING_SIZE, openBackup, sealBackup, type Hex } from '../../src/index';
import { referenceSeal } from './reference';
import { AUTHENTICATED, expectedOpened, MIXED_RULE, NONCE } from './samples';

const TIMEOUT = 60_000;
/** Any 2501-byte hex, so a refusal cannot come from the payload's length. */
const ANY_PAYLOAD: Hex = `0x${'00'.repeat(12 + BACKUP_PADDING_SIZE + 16)}`;

/** Whether the text survives UTF-8 encoding, which a lone surrogate does not: it becomes U+FFFD. */
const survivesUtf8 = (text: string): boolean => Buffer.from(text, 'utf8').toString('utf8') === text;

/** The error `attempt` rejects with; fails the test when it resolves. */
async function failure(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt;
  } catch (error) {
    return error;
  }

  throw new Error('expected the attempt to fail');
}

/** Counts the two WebCrypto calls the key derivation makes; restored by vi.restoreAllMocks. */
function spyOnDerivation(): () => number {
  const importKey = vi.spyOn(globalThis.crypto.subtle, 'importKey');
  const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');

  return () => importKey.mock.calls.length + deriveKey.mock.calls.length;
}

describe('a password that is not well-formed UTF-16 is refused before any key derivation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.for([
    ['a lone high surrogate', '\uD800'],
    ['a lone low surrogate', '\uDC00'],
    ['a lone high surrogate inside text', 'pass\uD83Dword'],
    ['a lone low surrogate inside text', 'pass\uDD11word'],
    ['a low surrogate before its high one', '\uDD11\uD83D'],
    ['a well-formed pair followed by a lone high surrogate', '🔑\uD83D'],
  ] as const)('refuses %s from sealBackup and openBackup as a TypeError', async ([, password]) => {
    const derivations = spyOnDerivation();
    const sealError = await failure(sealBackup(MIXED_RULE, password, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));
    const openError = await failure(openBackup(ANY_PAYLOAD, password, AUTHENTICATED));

    expect(survivesUtf8(password)).toBe(false);

    for (const error of [sealError, openError]) {
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toMatch(/^password /);
    }

    expect(derivations()).toBe(0);
  });

  it.for([
    ['a number', 42],
    ['undefined', undefined],
    ['a String object', Object('pw')],
  ] as const)('refuses %s as a TypeError from both, before any key derivation', async ([, password]) => {
    const derivations = spyOnDerivation();
    const text = password as unknown as string;

    await expect(sealBackup(MIXED_RULE, text, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED)).rejects.toBeInstanceOf(TypeError);
    await expect(openBackup(ANY_PAYLOAD, text, AUTHENTICATED)).rejects.toBeInstanceOf(TypeError);
    expect(derivations()).toBe(0);
  });
});

describe('a well-formed astral password still seals and opens', () => {
  it('seals a surrogate-pair password as node does over its UTF-8 bytes, and opens it', async () => {
    const password = 'key 🔑 𝄞';

    expect(survivesUtf8(password)).toBe(true);

    const payload = await sealBackup(MIXED_RULE, password, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED);

    expect(payload).toBe(referenceSeal(MIXED_RULE, password, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));
    await expect(openBackup(payload, password, AUTHENTICATED)).resolves.toEqual(expectedOpened(MIXED_RULE));
  }, TIMEOUT);
});
