import { isAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  configurationBody,
  configurationCommitment,
  encodeSetupBody,
  setupCommitment,
  type Configuration,
  type Credential,
  type Hex,
  type SetupDraft,
} from '../../src/index';
import { readVector } from '../kat/read-vector';
import {
  ACCOUNT,
  ACCOUNT_BAD_CHECKSUM,
  ACCOUNT_MIXED,
  ACTION,
  CONFIGURATION,
  METHOD_A,
  METHOD_B,
  referenceBody,
  referenceCommitment,
  referenceCredential,
  referenceEncodeBody,
  referenceSalt,
} from './support';

type CredentialRow = { readonly method: Hex; readonly config: Hex; readonly salt: Hex };

const credentialRows = readVector('credential-commitment.json').vectors;
const bodyRows = readVector('setup-body.json').vectors;
const commitmentRows = readVector('setup-commitment.json').vectors;

const rowById = (rows: typeof credentialRows, name: string) => {
  const row = rows.find((candidate) => candidate['id'] === name);

  if (row === undefined) throw new Error(`no vector row ${name}`);

  return row;
};

const oneCredential = (credential: Credential): Configuration => ({
  clauses: [{ threshold: 1, credentials: [credential] }],
  wait: 0,
  ignoresPause: false,
});

describe('configurationBody against the vectors', () => {
  it.each(['normal', 'zero-and-empty'])('a supplied salt yields the credential-commitment row %s', (name) => {
    const row = rowById(credentialRows, name);
    const input = row.input as CredentialRow;
    const expected = row.expected as { readonly commitment: Hex };
    const body = configurationBody(oneCredential({ method: input.method, config: input.config, salt: input.salt }), ACCOUNT);

    expect(body.clauses).toEqual([{ threshold: 1, credentials: [expected.commitment] }]);
  });

  it('the normal row is the first credential of the two-clauses body', () => {
    const input = rowById(credentialRows, 'normal').input as CredentialRow;
    const twoClauses = rowById(bodyRows, 'two-clauses').input as { readonly clauses: readonly { readonly credentials: readonly Hex[] }[] };
    const body = configurationBody(oneCredential({ method: input.method, config: input.config, salt: input.salt }), ACCOUNT);

    expect(body.clauses[0]?.credentials[0]).toBe(twoClauses.clauses[0]?.credentials[0]);
  });

  it.each([
    ['empty-clauses', { clauses: [], wait: 0, ignoresPause: true }],
    ['maximum-widths', { clauses: [{ threshold: 255, credentials: [] }], wait: 2 ** 48 - 1, ignoresPause: true }],
  ] as const)('the %s row encodes from its configuration', (name, configuration: Configuration) => {
    const expected = rowById(bodyRows, name).expected as { readonly encoded: Hex };

    expect(encodeSetupBody(configurationBody(configuration, ACCOUNT))).toBe(expected.encoded);
  });

  it('the independent commitment recomputation reproduces both setup-commitment rows', () => {
    for (const row of commitmentRows) {
      const input = row.input as { readonly account: Hex; readonly action: Hex; readonly nonce: string; readonly setupBody: Hex };
      const expected = row.expected as { readonly commitment: Hex };

      expect(referenceCommitment(input.account, input.action, BigInt(input.nonce), input.setupBody)).toBe(expected.commitment);
    }
  });
});

describe('configurationBody', () => {
  it('keeps clause order and thresholds, the wait and the pause choice', () => {
    const body = configurationBody(CONFIGURATION, ACCOUNT);

    expect(body.wait).toBe(CONFIGURATION.wait);
    expect(body.ignoresPause).toBe(CONFIGURATION.ignoresPause);
    expect(body.clauses.map((clause) => clause.threshold)).toEqual([1, 1]);
    expect(body.clauses.map((clause) => clause.credentials.length)).toEqual([2, 1]);
  });

  it('hashes a salt-less credential with the default salt of its flat place across clauses', () => {
    const body = configurationBody(CONFIGURATION, ACCOUNT);

    expect(body.clauses[0]?.credentials[1]).toBe(referenceCredential(METHOD_B, '0xbeef', referenceSalt(ACCOUNT, 1)));
    expect(body.clauses[1]?.credentials[0]).toBe(referenceCredential(METHOD_B, '0x', referenceSalt(ACCOUNT, 2)));
  });

  it('counts a salted credential as a place, so a later default salt is not shifted', () => {
    const shifted = configurationBody(CONFIGURATION, ACCOUNT).clauses[1]?.credentials[0];

    expect(shifted).not.toBe(referenceCredential(METHOD_B, '0x', referenceSalt(ACCOUNT, 1)));
    expect(shifted).not.toBe(referenceCredential(METHOD_B, '0x', referenceSalt(ACCOUNT, 0)));
  });

  it('uses a supplied salt as given, never the default', () => {
    const body = configurationBody(CONFIGURATION, ACCOUNT);

    expect(body.clauses[0]?.credentials[0]).toBe(referenceCredential(METHOD_A, '0x1234', `0x${'aa'.repeat(32)}`));
  });

  it('a supplied salt equal to the zero word is still used as given', () => {
    const zeroSalt: Hex = `0x${'00'.repeat(32)}`;
    const body = configurationBody(oneCredential({ method: METHOD_A, config: '0x', salt: zeroSalt }), ACCOUNT);

    expect(body.clauses[0]?.credentials[0]).toBe(referenceCredential(METHOD_A, '0x', zeroSalt));
  });

  it('equals the independent recomputation', () => {
    expect(configurationBody(CONFIGURATION, ACCOUNT)).toEqual(referenceBody(CONFIGURATION, ACCOUNT));
  });

  it('ignores labels', () => {
    const labelled: Configuration = {
      ...CONFIGURATION,
      clauses: CONFIGURATION.clauses.map((clause) => ({
        ...clause,
        credentials: clause.credentials.map((credential, index) => ({ ...credential, label: `contact ${index}` })),
      })),
    };

    expect(configurationBody(labelled, ACCOUNT)).toEqual(configurationBody(CONFIGURATION, ACCOUNT));
  });

  it('gives a draft the same body as its configuration', () => {
    const draft: SetupDraft = { ...CONFIGURATION, privacy: { publicMetadata: '0x', backup: 'encrypted' } };

    expect(configurationBody(draft, ACCOUNT)).toEqual(configurationBody(CONFIGURATION, ACCOUNT));
  });

  it('depends on the account only through the default salts', () => {
    const salted = oneCredential({ method: METHOD_A, config: '0x12', salt: `0x${'bb'.repeat(32)}` });
    const unsalted = oneCredential({ method: METHOD_A, config: '0x12' });

    expect(configurationBody(salted, ACCOUNT)).toEqual(configurationBody(salted, ACTION));
    expect(configurationBody(unsalted, ACCOUNT)).not.toEqual(configurationBody(unsalted, ACTION));
  });

  it('gives the same body for every accepted spelling of the account', () => {
    const lower = ACCOUNT_MIXED.toLowerCase() as Hex;
    const upper = `0x${ACCOUNT_MIXED.slice(2).toUpperCase()}` as Hex;
    const expected = referenceBody(CONFIGURATION, lower);

    for (const spelling of [lower, upper, ACCOUNT_MIXED]) expect(configurationBody(CONFIGURATION, spelling)).toEqual(expected);
  });

  it('refuses a mixed-case account whose checksum fails, with a TypeError', () => {
    expect(isAddress(ACCOUNT_BAD_CHECKSUM, { strict: true })).toBe(false);
    expect(() => configurationBody(CONFIGURATION, ACCOUNT_BAD_CHECKSUM)).toThrow(TypeError);
  });

  it('accepts any spelling of a method address with the same result', () => {
    const upper = `0x${METHOD_A.slice(2).toUpperCase()}` as Hex;

    expect(configurationBody(oneCredential({ method: upper, config: '0x' }), ACCOUNT)).toEqual(
      configurationBody(oneCredential({ method: METHOD_A, config: '0x' }), ACCOUNT),
    );
  });

  it('gives an empty-clause configuration an empty-clause body', () => {
    expect(configurationBody({ clauses: [], wait: 7, ignoresPause: true }, ACCOUNT)).toEqual({ wait: 7, ignoresPause: true, clauses: [] });
  });

  it('does not mutate the configuration', () => {
    const before = structuredClone(CONFIGURATION);

    configurationBody(CONFIGURATION, ACCOUNT);
    expect(CONFIGURATION).toEqual(before);
  });
});

describe('configurationCommitment', () => {
  it('is setupCommitment over the encoded body', () => {
    const encoded = encodeSetupBody(configurationBody(CONFIGURATION, ACCOUNT));

    expect(configurationCommitment(CONFIGURATION, ACCOUNT, ACTION, 7n)).toBe(setupCommitment(ACCOUNT, ACTION, 7n, encoded));
  });

  it('equals the independent recomputation', () => {
    const expected = referenceCommitment(ACCOUNT, ACTION, 7n, referenceEncodeBody(referenceBody(CONFIGURATION, ACCOUNT)));

    expect(configurationCommitment(CONFIGURATION, ACCOUNT, ACTION, 7n)).toBe(expected);
  });

  it('binds the nonce and the action', () => {
    const base = configurationCommitment(CONFIGURATION, ACCOUNT, ACTION, 7n);

    expect(configurationCommitment(CONFIGURATION, ACCOUNT, ACTION, 8n)).not.toBe(base);
    expect(configurationCommitment(CONFIGURATION, ACCOUNT, METHOD_A, 7n)).not.toBe(base);
  });

  it('gives a draft the same commitment as its configuration', () => {
    const draft: SetupDraft = { ...CONFIGURATION, privacy: { publicMetadata: '0x99', backup: 'clear' } };

    expect(configurationCommitment(draft, ACCOUNT, ACTION, 3n)).toBe(configurationCommitment(CONFIGURATION, ACCOUNT, ACTION, 3n));
  });

  it('gives the same lower-case commitment for every accepted spelling of account and action', () => {
    const lower = ACCOUNT_MIXED.toLowerCase() as Hex;
    const expected = configurationCommitment(CONFIGURATION, lower, ACTION, 1n);

    expect(expected).toBe(expected.toLowerCase());
    expect(configurationCommitment(CONFIGURATION, ACCOUNT_MIXED, ACTION.toUpperCase().replace('0X', '0x') as Hex, 1n)).toBe(expected);
  });
});

describe('configurationBody refuses a member outside its width', () => {
  const clause = (threshold: unknown) => ({ threshold, credentials: [{ method: METHOD_A, config: '0x' as Hex }] });

  it.each([
    ['a negative wait', { ...CONFIGURATION, wait: -1 }, RangeError],
    ['a wait of 2^48', { ...CONFIGURATION, wait: 2 ** 48 }, RangeError],
    ['a fractional wait', { ...CONFIGURATION, wait: 1.5 }, TypeError],
    ['a string wait', { ...CONFIGURATION, wait: '60' }, TypeError],
    ['a missing wait', { clauses: CONFIGURATION.clauses, ignoresPause: false }, TypeError],
    ['a threshold of 256', { ...CONFIGURATION, clauses: [clause(256)] }, RangeError],
    ['a negative threshold', { ...CONFIGURATION, clauses: [clause(-1)] }, RangeError],
    ['a fractional threshold', { ...CONFIGURATION, clauses: [clause(0.5)] }, TypeError],
    ['a missing threshold', { ...CONFIGURATION, clauses: [{ credentials: [] }] }, TypeError],
    ['a threshold in an empty clause after a good one', { ...CONFIGURATION, clauses: [clause(1), { threshold: 300, credentials: [] }] }, RangeError],
    ['a string ignoresPause', { ...CONFIGURATION, ignoresPause: 'yes' }, TypeError],
    ['a numeric ignoresPause', { ...CONFIGURATION, ignoresPause: 1 }, TypeError],
    ['a missing ignoresPause', { clauses: CONFIGURATION.clauses, wait: 60 }, TypeError],
  ] as const)('refuses %s', (_, configuration, kind) => {
    expect(() => configurationBody(configuration as unknown as Configuration, ACCOUNT)).toThrow(kind);
  });

  it('accepts the largest wait and threshold', () => {
    const body = configurationBody({ clauses: [{ threshold: 255, credentials: [] }], wait: 2 ** 48 - 1, ignoresPause: true }, ACCOUNT);

    expect(body).toEqual({ wait: 2 ** 48 - 1, ignoresPause: true, clauses: [{ threshold: 255, credentials: [] }] });
  });
});

/** A credential whose `method` and `config` reads are counted, so a test can tell whether it was hashed. */
function watchedCredential(reads: { count: number }): Credential {
  return {
    get method() {
      reads.count += 1;

      return METHOD_A;
    },
    get config() {
      reads.count += 1;

      return '0x' as Hex;
    },
  };
}

/** A list of `length` slots holding `make(index)` everywhere but at `hole`. */
function withHole<T>(length: number, hole: number, make: (index: number) => T): T[] {
  const list = new Array<T>(length);

  for (let index = 0; index < length; index += 1) if (index !== hole) list[index] = make(index);

  return list;
}

describe('configurationBody refuses a hole before any hash', () => {
  it.each([
    ['leading', 0],
    ['middle', 1],
    ['trailing', 2],
  ])('a %s hole in the credentials of a clause', (_, hole) => {
    const reads = { count: 0 };
    const configuration: Configuration = {
      ...CONFIGURATION,
      clauses: [
        { threshold: 1, credentials: [watchedCredential(reads)] },
        { threshold: 1, credentials: withHole(3, hole, () => watchedCredential(reads)) },
      ],
    };

    expect(() => configurationBody(configuration, ACCOUNT)).toThrow(TypeError);
    expect(() => configurationBody(configuration, ACCOUNT)).toThrow(new RegExp(`\\[${hole}\\]`));
    expect(reads.count).toBe(0);
  });

  it.each([
    ['leading', 0],
    ['middle', 1],
    ['trailing', 2],
  ])('a %s hole in the clauses', (_, hole) => {
    const reads = { count: 0 };
    const configuration: Configuration = {
      ...CONFIGURATION,
      clauses: withHole(3, hole, () => ({ threshold: 1, credentials: [watchedCredential(reads)] })),
    };

    expect(() => configurationBody(configuration, ACCOUNT)).toThrow(TypeError);
    expect(() => configurationBody(configuration, ACCOUNT)).toThrow(new RegExp(`\\[${hole}\\]`));
    expect(reads.count).toBe(0);
  });

  it('a trailing hole from a stretched length, in clauses and in credentials', () => {
    const clauses = [...CONFIGURATION.clauses];
    const credentials = [{ method: METHOD_A, config: '0x' as Hex }];

    clauses.length += 1;
    credentials.length += 1;
    expect(() => configurationBody({ ...CONFIGURATION, clauses }, ACCOUNT)).toThrow(TypeError);
    expect(() => configurationBody({ ...CONFIGURATION, clauses: [{ threshold: 1, credentials }] }, ACCOUNT)).toThrow(TypeError);
  });

  it('refuses the hole through configurationCommitment too', () => {
    const configuration = { ...CONFIGURATION, clauses: withHole(2, 0, () => CONFIGURATION.clauses[0]!) };

    expect(() => configurationCommitment(configuration, ACCOUNT, ACTION, 1n)).toThrow(TypeError);
  });

  it('an explicit undefined credential is refused like a hole', () => {
    const configuration = { ...CONFIGURATION, clauses: [{ threshold: 1, credentials: [undefined] }] } as unknown as Configuration;

    expect(() => configurationBody(configuration, ACCOUNT)).toThrow(TypeError);
  });
});
