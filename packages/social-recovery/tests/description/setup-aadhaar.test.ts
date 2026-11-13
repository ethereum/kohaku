import { encodeAbiParameters } from 'viem';
import { describe, expect, it } from 'vitest';
import { describeSetup, type Address, type Hex, type SetupDescriptionContext, type SetupDraft } from '../../src/index';
import { AADHAAR, CONTEXT, DESCRIPTOR, DRAFT, METHOD_READS, PASSKEY, reads, THIRD_PARTY } from './setup-fixtures';

const AADHAAR_LAYOUT = [
  { name: 'nullifier', type: 'uint256' },
  { name: 'nullifierSeed', type: 'uint256' },
  { name: 'freshnessWindow', type: 'uint256' },
] as const;

/** An Aadhaar config, `abi.encode(nullifier, seed, window)`, written with viem directly. */
const aadhaarConfig = (freshnessWindow: bigint, nullifier = 22n, nullifierSeed = 77n): Hex =>
  encodeAbiParameters(AADHAAR_LAYOUT, [nullifier, nullifierSeed, freshnessWindow]);

const WORD_MAX = (1n << 256n) - 1n;
const OTHER_MODULE: Address = '0x3000000000000000000000000000000000000077';

/** The fixture context with the Aadhaar module's reads added, every one answered. */
const AADHAAR_CONTEXT: SetupDescriptionContext = { ...CONTEXT, methods: [...METHOD_READS, reads(AADHAAR, 'method-aadhaar')] };

/** The fixture draft with its second clause replaced by these credentials, flat places 3 onwards. */
function withSecondClause(credentials: readonly { readonly method: Address; readonly config: Hex }[]): SetupDraft {
  const [first, second] = DRAFT.clauses;

  if (first === undefined || second === undefined) throw new Error('fixture lacks its two clauses');

  return { ...DRAFT, clauses: [first, { ...second, credentials }] };
}

/** Two Aadhaar credentials around a third-party one: places 3, 4 and 5. */
const TWO_AADHAAR = withSecondClause([
  { method: AADHAAR, config: aadhaarConfig(7_200n) },
  { method: THIRD_PARTY, config: `0x${'00'.repeat(31)}09` },
  { method: AADHAAR, config: aadhaarConfig(4_500n, 23n, 78n) },
]);

/** The description with every method entry reduced to its method and declaration, its named keys left out. */
const unnamed = <T extends { readonly parties: { readonly methods: readonly { readonly method: Address; readonly parties: unknown }[] } }>(description: T) => ({
  ...description,
  parties: { ...description.parties, methods: description.parties.methods.map((entry) => ({ method: entry.method, parties: entry.parties })) },
});

/** Calls describeSetup and returns what it threw, or undefined. */
function thrown(draft: SetupDraft): unknown {
  try {
    describeSetup(draft, AADHAAR_CONTEXT);
  } catch (error) {
    return error;
  }

  return undefined;
}

describe('describeSetup shows the window of each Aadhaar credential', () => {
  it('lists place and window per Aadhaar credential, in place order, skipping every other method', () => {
    expect(describeSetup(TWO_AADHAAR, AADHAAR_CONTEXT).aadhaarWindows).toEqual([
      { place: 3, freshnessWindow: 7_200n },
      { place: 5, freshnessWindow: 4_500n },
    ]);
  });

  it('lists nothing for a setup without an Aadhaar credential', () => {
    expect(describeSetup(DRAFT, CONTEXT).aadhaarWindows).toEqual([]);
    expect(describeSetup({ ...DRAFT, clauses: [] }, { ...CONTEXT, methods: [] }).aadhaarWindows).toEqual([]);
  });

  it('shows the window as a bigint of seconds', () => {
    const [entry] = describeSetup(TWO_AADHAAR, AADHAAR_CONTEXT).aadhaarWindows;

    expect(typeof entry?.freshnessWindow).toBe('bigint');
    expect(typeof entry?.place).toBe('number');
  });

  it.each([
    ['one second, which validation reports', 1n],
    ['zero', 0n],
    ['one second under the hour', 3_599n],
    ['the largest word, the module having no ceiling', WORD_MAX],
  ])('a window of %s is shown as it is', (_why, window) => {
    const draft = withSecondClause([{ method: AADHAAR, config: aadhaarConfig(window) }]);

    expect(describeSetup(draft, AADHAAR_CONTEXT).aadhaarWindows).toEqual([{ place: 3, freshnessWindow: window }]);
  });

  it('accepts an upper-case spelling of the same config bytes', () => {
    const upper = `0x${aadhaarConfig(7_200n).slice(2).toUpperCase()}` as Hex;
    const draft = withSecondClause([{ method: AADHAAR, config: upper }]);

    expect(describeSetup(draft, AADHAAR_CONTEXT).aadhaarWindows).toEqual([{ place: 3, freshnessWindow: 7_200n }]);
  });

  it('a credential under another module carrying the same bytes is no Aadhaar credential', () => {
    const draft = withSecondClause([{ method: THIRD_PARTY, config: aadhaarConfig(7_200n) }]);

    expect(describeSetup(draft, AADHAAR_CONTEXT).aadhaarWindows).toEqual([]);
  });
});

describe('describeSetup refuses an Aadhaar config outside the three-word layout', () => {
  const words = aadhaarConfig(7_200n).slice(2);

  it.each<readonly [string, Hex]>([
    ['64 bytes, the two-word layout before the window', `0x${words.slice(0, 128)}`],
    ['95 bytes', `0x${words.slice(0, 190)}`],
    ['97 bytes, decoding but re-encoding shorter', `0x${words}00`],
    ['128 bytes, decoding but re-encoding shorter', `0x${words}${'00'.repeat(32)}`],
    ['empty bytes', '0x'],
  ])('throws a TypeError naming the credential\'s config for %s', (_case, config) => {
    const error = thrown(withSecondClause([{ method: THIRD_PARTY, config: `0x${'00'.repeat(31)}09` }, { method: AADHAAR, config }]));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('draft.clauses[1].credentials[1].config');
    expect((error as Error).message).toMatch(/aadhaar/i);
  });
});

describe('the window leaves every other member of the description as it was', () => {
  it('the same draft under a deployment naming another Aadhaar module differs only in aadhaarWindows and the Aadhaar entry\'s namedKeys', () => {
    const { aadhaarWindows: shown, ...described } = describeSetup(TWO_AADHAAR, AADHAAR_CONTEXT);
    const elsewhere = { ...AADHAAR_CONTEXT, descriptor: { ...DESCRIPTOR, methodAadhaar: OTHER_MODULE } };
    const { aadhaarWindows: none, ...describedElsewhere } = describeSetup(TWO_AADHAAR, elsewhere);
    const aadhaarEntry = (methods: typeof described.parties.methods) => methods.find((entry) => entry.method === AADHAAR);

    expect(shown).toHaveLength(2);
    expect(none).toEqual([]);
    expect(aadhaarEntry(described.parties.methods)?.namedKeys?.kind).toBe('method-aadhaar');
    expect(aadhaarEntry(describedElsewhere.parties.methods)).not.toHaveProperty('namedKeys');
    expect(unnamed(described)).toEqual(unnamed(describedElsewhere));
  });

  it('the passkey domains are still the passkey credentials alone', () => {
    const description = describeSetup(TWO_AADHAAR, AADHAAR_CONTEXT);

    expect(description.passkeyDomains.map((entry) => entry.place)).toEqual([1]);
    expect(description.rule.clauses[1]?.credentials.map((entry) => entry.method)).toEqual([AADHAAR, THIRD_PARTY, AADHAAR]);
    expect(description.rule.clauses[0]?.credentials.some((entry) => entry.method === PASSKEY)).toBe(true);
  });
});
