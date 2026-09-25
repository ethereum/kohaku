import { describe, expect, it } from 'vitest';
import { decodeSetupBody, encodeSetupBody, setupCommitment, type SetupBody } from '../../src/index';
import { A_ACCOUNT, AN_ACTION, join, oracleBody, repeat, UINT48_MAX, word, type Hex } from './support';

/** Hand-rolled abi.encode of the body, word by word, independent of any ABI library. */
const handBody = (wait: number, ignoresPause: boolean, clauses: readonly { t: number; c: readonly Hex[] }[]): Hex => {
  const offsets: string[] = [];
  const bodies: string[] = [];
  let offset = clauses.length * 32;

  for (const clause of clauses) {
    offsets.push(word(offset));
    bodies.push(word(clause.t) + word(0x40) + word(clause.c.length) + clause.c.map((c) => c.slice(2)).join(''));
    offset += (3 + clause.c.length) * 32;
  }

  return join(word(wait), word(ignoresPause ? 1 : 0), word(0x60), word(clauses.length), ...offsets, ...bodies);
};

const cred = (n: number): Hex => `0x${word(n)}`;

const ROWS: readonly [string, SetupBody, Hex][] = [
  ['empty clauses', { wait: 0, ignoresPause: false, clauses: [] }, handBody(0, false, [])],
  ['empty clauses, pause ignored', { wait: 0, ignoresPause: true, clauses: [] }, handBody(0, true, [])],
  [
    'the all-zero rule (one clause at zero, no credentials)',
    { wait: 0, ignoresPause: false, clauses: [{ threshold: 0, credentials: [] }] },
    handBody(0, false, [{ t: 0, c: [] }]),
  ],
  [
    'one clause, one credential',
    { wait: 86_400, ignoresPause: false, clauses: [{ threshold: 1, credentials: [cred(0xbeef)] }] },
    handBody(86_400, false, [{ t: 1, c: [cred(0xbeef)] }]),
  ],
  [
    'a threshold above its credential count',
    { wait: 1, ignoresPause: false, clauses: [{ threshold: 3, credentials: [cred(1)] }] },
    handBody(1, false, [{ t: 3, c: [cred(1)] }]),
  ],
  [
    'a zero clause beside a clause above zero',
    {
      wait: 172_800,
      ignoresPause: true,
      clauses: [
        { threshold: 0, credentials: [cred(9)] },
        { threshold: 2, credentials: [cred(1), cred(2), cred(3)] },
        { threshold: 1, credentials: [] },
      ],
    },
    handBody(172_800, true, [
      { t: 0, c: [cred(9)] },
      { t: 2, c: [cred(1), cred(2), cred(3)] },
      { t: 1, c: [] },
    ]),
  ],
  [
    'maximum widths',
    { wait: UINT48_MAX, ignoresPause: true, clauses: [{ threshold: 255, credentials: [repeat('ff', 32)] }] },
    handBody(UINT48_MAX, true, [{ t: 255, c: [repeat('ff', 32)] }]),
  ],
];

describe('encodeSetupBody', () => {
  it('the hand encoder agrees with a reference abi.encode on every row', () => {
    for (const [, body, bytes] of ROWS) expect(oracleBody(body)).toBe(bytes);
  });

  it.each(ROWS)('encodes %s to the hand-built bytes', (_label, body, bytes) => {
    expect(encodeSetupBody(body)).toBe(bytes);
  });

  it('the empty-clauses body is four words, no leading tuple offset', () => {
    expect(encodeSetupBody({ wait: 0, ignoresPause: false, clauses: [] })).toBe(
      join(word(0), word(0), word(0x60), word(0)),
    );
  });

  it('never yields zero-length bytes, so its commitment differs from that of empty bytes', () => {
    const encoded = encodeSetupBody({ wait: 0, ignoresPause: false, clauses: [] });

    expect(encoded.length).toBeGreaterThan(2);
    expect(setupCommitment(A_ACCOUNT, AN_ACTION, 1n, encoded)).not.toBe(setupCommitment(A_ACCOUNT, AN_ACTION, 1n, '0x'));
  });

  it('keeps the holder order of credentials and clauses', () => {
    const forward = encodeSetupBody({ wait: 0, ignoresPause: false, clauses: [{ threshold: 1, credentials: [cred(1), cred(2)] }] });
    const reversed = encodeSetupBody({ wait: 0, ignoresPause: false, clauses: [{ threshold: 1, credentials: [cred(2), cred(1)] }] });

    expect(forward).not.toBe(reversed);
  });

  const base: SetupBody = { wait: 0, ignoresPause: false, clauses: [{ threshold: 1, credentials: [cred(1)] }] };

  it.each([
    ['wait 2^48', { ...base, wait: 2 ** 48 }, RangeError],
    ['a negative wait', { ...base, wait: -1 }, RangeError],
    ['a fractional wait', { ...base, wait: 1.5 }, TypeError],
    ['a NaN wait', { ...base, wait: Number.NaN }, TypeError],
    ['threshold 256', { ...base, clauses: [{ threshold: 256, credentials: [] }] }, RangeError],
    ['a negative threshold', { ...base, clauses: [{ threshold: -1, credentials: [] }] }, RangeError],
    ['a 31-byte credential', { ...base, clauses: [{ threshold: 1, credentials: [repeat('11', 31)] }] }, TypeError],
    ['a 33-byte credential', { ...base, clauses: [{ threshold: 1, credentials: [repeat('11', 33)] }] }, TypeError],
    ['an odd-length credential', { ...base, clauses: [{ threshold: 1, credentials: [`${cred(1)}0`] }] }, TypeError],
  ] as [string, SetupBody, ErrorConstructor][])('refuses %s', (_label, body, error) => {
    expect(() => encodeSetupBody(body)).toThrow(error);
  });

  it('refuses a non-boolean pause flag and a non-array clause list', () => {
    expect(() => encodeSetupBody({ ...base, ignoresPause: 1 as unknown as boolean })).toThrow(TypeError);
    expect(() => encodeSetupBody({ ...base, clauses: {} as unknown as SetupBody['clauses'] })).toThrow(TypeError);
  });
});

describe('decodeSetupBody', () => {
  it.each(ROWS)('decodes %s back to its three members', (_label, body, bytes) => {
    expect(decodeSetupBody(bytes)).toEqual(body);
  });

  it('accepts uppercase hex digits of a canonical body', () => {
    const bytes = handBody(5, true, [{ t: 1, c: [repeat('ab', 32)] }]);

    expect(decodeSetupBody(`0x${bytes.slice(2).toUpperCase()}`)).toEqual({
      wait: 5,
      ignoresPause: true,
      clauses: [{ threshold: 1, credentials: [repeat('ab', 32)] }],
    });
  });

  it('refuses zero-length bytes', () => {
    expect(() => decodeSetupBody('0x')).toThrow(RangeError);
  });

  it('refuses odd-length hex', () => {
    expect(() => decodeSetupBody(`${handBody(0, false, [])}0` as Hex)).toThrow(TypeError);
  });

  it('refuses a body truncated by one word', () => {
    const bytes = handBody(0, false, [{ t: 1, c: [cred(1)] }]);

    expect(() => decodeSetupBody(bytes.slice(0, -64) as Hex)).toThrow(RangeError);
  });

  it('refuses trailing bytes (strict: the manager itself would accept them)', () => {
    expect(() => decodeSetupBody(`${handBody(0, false, [])}00`)).toThrow(RangeError);
  });

  it('refuses a wait word wider than uint48', () => {
    expect(() => decodeSetupBody(join(word(2 ** 48), word(0), word(0x60), word(0)))).toThrow(RangeError);
  });

  it('refuses a bool word other than 0 or 1', () => {
    expect(() => decodeSetupBody(join(word(0), word(2), word(0x60), word(0)))).toThrow(RangeError);
  });

  it('refuses a threshold word wider than uint8', () => {
    const bytes = join(word(0), word(0), word(0x60), word(1), word(0x20), word(256), word(0x40), word(0));

    expect(() => decodeSetupBody(bytes)).toThrow(RangeError);
  });
});
