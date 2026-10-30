import { describe, expect, it } from 'vitest';
import { describeSetup, type Address, type Hex, type SetupDraft } from '../../src/index';
import { readVector } from '../kat/read-vector';
import { CONTEXT, DRAFT, ECDSA, GUARDIAN, PASSKEY, PASSKEY_CONFIG } from './setup-fixtures';

const zeroRow = readVector('method-ecdsa-config.json').vectors.find((row) => row['id'] === 'zero-address');
const ZERO_GUARDIAN = (zeroRow?.expected as { encoded?: Hex } | undefined)?.encoded;

/** The fixture draft with the credential at place 4 (second clause, second credential) replaced. */
function withPlaceFour(method: Address, config: Hex): SetupDraft {
  const [first, second] = DRAFT.clauses;

  if (first === undefined || second === undefined) throw new Error('fixture lacks its two clauses');

  const kept = second.credentials[0];

  if (kept === undefined) throw new Error('fixture lacks place 3');

  return { ...DRAFT, clauses: [first, { ...second, credentials: [kept, { method, config }] }] };
}

/** Calls describeSetup and returns what it threw, or undefined. */
function thrown(draft: SetupDraft): unknown {
  try {
    describeSetup(draft, CONTEXT);
  } catch (error) {
    return error;
  }

  return undefined;
}

const NAMES_PLACE_FOUR = /credentials\[1\]|\b4\b/;

const passkeyWords = PASSKEY_CONFIG.encoded.slice(2);

describe('describeSetup refuses a wallet config that names no guardian', () => {
  it.each<readonly [string, Hex]>([
    ['the zero address', ZERO_GUARDIAN ?? '0x'],
    ['31 bytes', `0x${GUARDIAN.encoded.slice(4)}`],
    ['33 bytes', `${GUARDIAN.encoded}00`],
    ['an address word with nonzero high bytes', `0x${'ff'.repeat(12)}${GUARDIAN.encoded.slice(26)}`],
    ['empty bytes', '0x'],
  ])('throws a TypeError naming the credential for %s', (_case, config) => {
    const error = thrown(withPlaceFour(ECDSA, config));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(NAMES_PLACE_FOUR);
  });

  it('reads the zero-address config from the blessed row', () => {
    expect(ZERO_GUARDIAN).toBe(`0x${'0'.repeat(64)}`);
  });
});

describe('describeSetup refuses a passkey config outside the three-word layout', () => {
  it.each<readonly [string, Hex]>([
    ['64 bytes', `0x${passkeyWords.slice(0, 128)}`],
    ['95 bytes', `0x${passkeyWords.slice(0, 190)}`],
    ['97 bytes, decoding but re-encoding shorter', `${PASSKEY_CONFIG.encoded}00`],
    ['128 bytes, decoding but re-encoding shorter', `${PASSKEY_CONFIG.encoded}${'00'.repeat(32)}`],
    ['empty bytes', '0x'],
  ])('throws a TypeError naming the credential for %s', (_case, config) => {
    const error = thrown(withPlaceFour(PASSKEY, config));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(NAMES_PLACE_FOUR);
  });
});

describe('describeSetup on well-formed configs', () => {
  it('describes a wallet and a passkey credential at place 4 without throwing', () => {
    const guardian = describeSetup(withPlaceFour(ECDSA, GUARDIAN.encoded), CONTEXT);
    const passkey = describeSetup(withPlaceFour(PASSKEY, PASSKEY_CONFIG.encoded), CONTEXT);

    expect(guardian.parties.walletGuardians.map((entry) => entry.place)).toEqual([0, 2, 4]);
    expect(passkey.passkeyDomains).toEqual([
      { place: 1, relyingPartyIdHash: PASSKEY_CONFIG.value },
      { place: 4, relyingPartyIdHash: PASSKEY_CONFIG.value },
    ]);
  });

  it('accepts an upper-case spelling of the same passkey config bytes', () => {
    const upper = `0x${passkeyWords.toUpperCase()}` as Hex;

    expect(describeSetup(withPlaceFour(PASSKEY, upper), CONTEXT).passkeyDomains).toContainEqual({ place: 4, relyingPartyIdHash: PASSKEY_CONFIG.value });
  });
});
