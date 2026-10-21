import { describe, expect, it } from 'vitest';
import type { Fields } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { stackDouble } from './fixtures';

const { codec } = anonAadhaarMethod({ stack: stackDouble().stack });

const WORD_LIMIT = 1n << 256n;
const WINDOW = 86_400n;

/** A copy of `values` with the slot at `index` left empty: the same length, one hole. */
function holed<T>(values: readonly T[], index: number): T[] {
  const copy: T[] = [];

  values.forEach((value, at) => {
    if (at !== index) copy[at] = value;
  });
  copy.length = values.length;

  return copy;
}

type ProofFields = {
  readonly a: readonly unknown[];
  readonly b: readonly (readonly unknown[])[];
  readonly c: readonly unknown[];
  readonly inputs: readonly unknown[];
};

const GOOD: ProofFields = {
  a: [1n, 2n],
  b: [
    [4n, 3n],
    [6n, 5n],
  ],
  c: [7n, 8n],
  inputs: [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n],
};

const encodeProof = (fields: ProofFields): unknown => codec.encodeProof(fields as unknown as Fields);

/** Whether the error is a malformed-argument fault: a TypeError for the shape or a RangeError for the range. */
const isArgumentFault = (error: unknown): boolean => error instanceof TypeError || error instanceof RangeError;

/** The error `run` throws, or `undefined` when it returns. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  return undefined;
}

describe('a hole in a proof list is a TypeError naming the position, never a zero word', () => {
  const cases: readonly (readonly [string, ProofFields, string])[] = [
    ['a, first slot', { ...GOOD, a: holed(GOOD.a, 0) }, 'a[0]'],
    ['a, last slot', { ...GOOD, a: holed(GOOD.a, 1) }, 'a[1]'],
    ['c, first slot', { ...GOOD, c: holed(GOOD.c, 0) }, 'c[0]'],
    ['c, last slot', { ...GOOD, c: holed(GOOD.c, 1) }, 'c[1]'],
    ['b, the second pair missing', { ...GOOD, b: holed(GOOD.b, 1) }, 'b[1]'],
    ['b, the first pair missing', { ...GOOD, b: holed(GOOD.b, 0) }, 'b[0]'],
    ['b[0], last slot', { ...GOOD, b: [holed(GOOD.b[0] ?? [], 1), GOOD.b[1] ?? []] }, 'b[0][1]'],
    ['b[1], first slot', { ...GOOD, b: [GOOD.b[0] ?? [], holed(GOOD.b[1] ?? [], 0)] }, 'b[1][0]'],
    ['inputs, first slot', { ...GOOD, inputs: holed(GOOD.inputs, 0) }, 'inputs[0]'],
    ['inputs, a middle slot', { ...GOOD, inputs: holed(GOOD.inputs, 4) }, 'inputs[4]'],
    ['inputs, the last slot', { ...GOOD, inputs: holed(GOOD.inputs, 8) }, 'inputs[8]'],
  ];

  it.each(cases)('%s', (_label, fields, position) => {
    const error = thrown(() => encodeProof(fields));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain(position);
  });

  it('a list one longer whose extra slot is a hole is refused as an argument fault', () => {
    const inputs = [...GOOD.inputs];

    inputs.length = 10;

    expect(isArgumentFault(thrown(() => encodeProof({ ...GOOD, inputs })))).toBe(true);
  });

  it('a list of the right length made of nothing but holes is refused at slot 0', () => {
    const empty: bigint[] = [];

    empty.length = 9;

    const error = thrown(() => encodeProof({ ...GOOD, inputs: empty }));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('inputs[0]');
  });
});

describe('a list of the wrong length is an argument fault, never a plain Error', () => {
  it.each([
    ['a one short', { ...GOOD, a: [1n] }],
    ['a one long', { ...GOOD, a: [1n, 2n, 3n] }],
    ['c one short', { ...GOOD, c: [7n] }],
    ['c one long', { ...GOOD, c: [7n, 8n, 9n] }],
    ['b one short', { ...GOOD, b: [[4n, 3n]] }],
    ['b one long', { ...GOOD, b: [...GOOD.b, [1n, 0n]] }],
    ['a b pair one short', { ...GOOD, b: [[4n], [6n, 5n]] }],
    ['a b pair one long', { ...GOOD, b: [[4n, 3n], [6n, 5n, 0n]] }],
    ['inputs one short', { ...GOOD, inputs: GOOD.inputs.slice(0, 8) }],
    ['inputs one long', { ...GOOD, inputs: [...GOOD.inputs, 10n] }],
  ])('%s', (_label, fields) => {
    expect(isArgumentFault(thrown(() => encodeProof(fields)))).toBe(true);
  });

  it.each([
    ['inputs not a list', { ...GOOD, inputs: 9n as unknown as readonly unknown[] }],
    ['b not a list of lists', { ...GOOD, b: [1n, 2n] as unknown as readonly (readonly unknown[])[] }],
    ['a an object, not a list', { ...GOOD, a: { 0: 1n, 1: 2n, length: 2 } as unknown as readonly unknown[] }],
  ])('%s is a TypeError', (_label, fields) => {
    expect(thrown(() => encodeProof(fields))).toBeInstanceOf(TypeError);
  });
});

describe('a proof word of the right type but out of range is a RangeError', () => {
  it.each([
    ['a[0] = -1', { ...GOOD, a: [-1n, 2n] }],
    ['a[1] = 2^256', { ...GOOD, a: [1n, WORD_LIMIT] }],
    ['b[1][0] = 2^256', { ...GOOD, b: [[4n, 3n], [WORD_LIMIT, 5n]] }],
    ['c[0] = -2^255', { ...GOOD, c: [-(1n << 255n), 8n] }],
    ['inputs[8] = 2^256', { ...GOOD, inputs: [...GOOD.inputs.slice(0, 8), WORD_LIMIT] }],
    ['inputs[3] = -1', { ...GOOD, inputs: [1n, 2n, 3n, -1n, 5n, 6n, 7n, 8n, 9n] }],
  ])('%s', (_label, fields) => {
    expect(thrown(() => encodeProof(fields))).toBeInstanceOf(RangeError);
  });

  it('accepts 2^256 - 1 and 0 in every word', () => {
    const max = WORD_LIMIT - 1n;

    expect(() => encodeProof({ a: [max, 0n], b: [[max, 0n], [0n, max]], c: [0n, max], inputs: Array.from({ length: 9 }, () => max) })).not.toThrow();
  });
});

describe('a proof word of the wrong type is a TypeError', () => {
  it.each([
    ['a decimal string in a', { ...GOOD, a: ['1', 2n] }],
    ['a number in c', { ...GOOD, c: [7, 8n] }],
    ['null in a b pair', { ...GOOD, b: [[4n, null], [6n, 5n]] }],
    ['undefined written into inputs', { ...GOOD, inputs: [...GOOD.inputs.slice(0, 8), undefined] }],
    ['decimal strings for every input', { ...GOOD, inputs: GOOD.inputs.map(String) }],
    ['a hex string in a', { ...GOOD, a: ['0x01', 2n] }],
  ])('%s', (_label, fields) => {
    expect(thrown(() => encodeProof(fields))).toBeInstanceOf(TypeError);
  });
});

describe('encodeConfig refusals carry the class of the fault and name the field', () => {
  it.each([
    ['nullifier = 2^256', { nullifier: WORD_LIMIT, nullifierSeed: 1n, freshnessWindow: WINDOW }, 'nullifier'],
    ['nullifier = -1', { nullifier: -1n, nullifierSeed: 1n, freshnessWindow: WINDOW }, 'nullifier'],
    ['nullifierSeed = 2^256', { nullifier: 1n, nullifierSeed: WORD_LIMIT, freshnessWindow: WINDOW }, 'nullifierSeed'],
    ['nullifierSeed = -1', { nullifier: 1n, nullifierSeed: -1n, freshnessWindow: WINDOW }, 'nullifierSeed'],
    ['freshnessWindow = 2^256', { nullifier: 1n, nullifierSeed: 1n, freshnessWindow: WORD_LIMIT }, 'freshnessWindow'],
    ['freshnessWindow = -1', { nullifier: 1n, nullifierSeed: 1n, freshnessWindow: -1n }, 'freshnessWindow'],
  ])('%s is a RangeError', (_label, fields, name) => {
    const error = thrown(() => codec.encodeConfig(fields));

    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toContain(name);
  });

  it.each([
    ['a decimal string nullifier', { nullifier: '22', nullifierSeed: 77n, freshnessWindow: WINDOW }, 'nullifier'],
    ['a number seed', { nullifier: 22n, nullifierSeed: 77, freshnessWindow: WINDOW }, 'nullifierSeed'],
    ['a missing seed', { nullifier: 22n, freshnessWindow: WINDOW }, 'nullifierSeed'],
    ['a missing nullifier', { nullifierSeed: 77n, freshnessWindow: WINDOW }, 'nullifier'],
    ['a null nullifier', { nullifier: null, nullifierSeed: 77n, freshnessWindow: WINDOW }, 'nullifier'],
    ['a missing window', { nullifier: 22n, nullifierSeed: 77n }, 'freshnessWindow'],
    ['a decimal string window', { nullifier: 22n, nullifierSeed: 77n, freshnessWindow: '86400' }, 'freshnessWindow'],
  ])('%s is a TypeError naming the field', (_label, fields, name) => {
    const error = thrown(() => codec.encodeConfig(fields as unknown as Fields));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain(name);
  });

  it('an extra field is a TypeError naming it', () => {
    const error = thrown(() => codec.encodeConfig({ nullifier: 22n, nullifierSeed: 77n, freshnessWindow: WINDOW, junk: 1n }));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('junk');
  });

  it('two extra fields: the TypeError names the first one written', () => {
    const error = thrown(() => codec.encodeConfig({ nullifier: 22n, nullifierSeed: 77n, freshnessWindow: WINDOW, zeta: 1n, alpha: 2n }));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('zeta');
  });

  it('an extra field set to undefined is still an extra field', () => {
    expect(
      thrown(() => codec.encodeConfig({ nullifier: 22n, nullifierSeed: 77n, freshnessWindow: WINDOW, junk: undefined } as unknown as Fields)),
    ).toBeInstanceOf(TypeError);
  });

  it('the three named fields alone encode', () => {
    expect(() => codec.encodeConfig({ nullifier: 22n, nullifierSeed: 77n, freshnessWindow: WINDOW })).not.toThrow();
  });
});

describe('no codec refusal is a plain Error', () => {
  it.each([
    ['decodeConfig of 63 bytes', () => codec.decodeConfig(`0x${'00'.repeat(63)}`)],
    ['decodeConfig of 64 bytes', () => codec.decodeConfig(`0x${'00'.repeat(64)}`)],
    ['decodeConfig of 95 bytes', () => codec.decodeConfig(`0x${'00'.repeat(95)}`)],
    ['decodeConfig of non-hex', () => codec.decodeConfig(`0x${'zz'.repeat(96)}`)],
    ['decodeConfig of a number', () => codec.decodeConfig(5 as never)],
    ['decodeProof of 543 bytes', () => codec.decodeProof(`0x${'00'.repeat(543)}`)],
    ['decodeProof of odd digits', () => codec.decodeProof(`0x${'0'.repeat(1087)}`)],
    ['encodeConfig of null', () => codec.encodeConfig(null as never)],
    ['encodeProof of null', () => codec.encodeProof(null as never)],
  ])('%s', (_label, run) => {
    const error = thrown(run);

    expect(error).toBeDefined();
    expect(isArgumentFault(error)).toBe(true);
  });
});
