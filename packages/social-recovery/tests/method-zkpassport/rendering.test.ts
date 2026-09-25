import { describe, expect, it } from 'vitest';
import { zkPassportMethod } from '../../src/method-zkpassport';
import type { Hex } from '../../src/interfaces';
import { encodeConfig, makeCtx, PARAMS, stackDouble, word, type StackCall } from './fixtures';

const CONFIG = encodeConfig(word(7), word(1), PARAMS.domain, PARAMS.scope, 3600n);

/** The rendering from the digest's value: `0x` and the value in 64 lowercase hex digits. */
const rendering = (digest: string): string => `0x${BigInt(digest).toString(16).padStart(64, '0')}`;

const DIGESTS: readonly (readonly [string, Hex])[] = [
  ['the proof vector digest', '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339'],
  ['a digest with leading zero bytes', '0x0000000000000000000000000000000000000000000000000000000000c0ffee'],
  ['a digest with one leading zero nibble', '0x0fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
  ['the zero digest', `0x${'00'.repeat(32)}`],
  ['the all-ones digest', `0x${'ff'.repeat(32)}`],
  ['a mixed-case digest', '0xAbCdEf0123456789aBcDeF0123456789ABCDEF0123456789abcdef0123456789'],
  ['an upper-case digest', '0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF'],
];

const binds = (calls: readonly StackCall[]) => calls.filter((call) => call.kind === 'bind');

describe('the digest text bound as the custom field', () => {
  it.each(DIGESTS)('%s renders as 0x and 64 lowercase hex, and reaches bind("custom_data", ...) byte-identical', async (_name, digest) => {
    const double = stackDouble();
    const method = zkPassportMethod(double.stack);
    const input = method.signingInput(makeCtx(CONFIG, digest), PARAMS);
    const expected = rendering(digest);

    expect(expected).toMatch(/^0x[0-9a-f]{64}$/);
    expect(expected).toHaveLength(66);

    const open = input['openRequest'] as () => Promise<unknown>;

    await open();

    const bound = binds(double.calls);

    expect(bound).toHaveLength(1);
    expect(bound[0]).toMatchObject({ kind: 'bind', key: 'custom_data', value: expected });

    const value = (bound[0] as { value: string }).value;

    expect(Buffer.from(value, 'utf8').equals(Buffer.from(expected, 'utf8'))).toBe(true);
  });

  it('keeps leading zeros: the text is always 66 characters, never the shortest hex of the value', async () => {
    const double = stackDouble();
    const digest: Hex = `0x${'00'.repeat(31)}01`;

    await (zkPassportMethod(double.stack).signingInput(makeCtx(CONFIG, digest), PARAMS)['openRequest'] as () => Promise<unknown>)();

    expect(binds(double.calls)[0]).toMatchObject({ value: `0x${'0'.repeat(63)}1` });
  });

  it('two digests differing in one bit bind two different texts', async () => {
    const one = stackDouble();
    const two = stackDouble();
    const a: Hex = `0x${'00'.repeat(31)}02`;
    const b: Hex = `0x${'00'.repeat(31)}03`;

    await (zkPassportMethod(one.stack).signingInput(makeCtx(CONFIG, a), PARAMS)['openRequest'] as () => Promise<unknown>)();
    await (zkPassportMethod(two.stack).signingInput(makeCtx(CONFIG, b), PARAMS)['openRequest'] as () => Promise<unknown>)();

    expect(binds(one.calls)[0]).not.toEqual(binds(two.calls)[0]);
  });

  it.each([
    ['31 bytes', `0x${'11'.repeat(31)}`],
    ['33 bytes', `0x${'11'.repeat(33)}`],
    ['no 0x prefix', '11'.repeat(32)],
    ['non-hex characters', `0x${'zz'.repeat(32)}`],
  ])('signingInput refuses a digest of %s rather than binding another rendering', (_why, digest) => {
    const double = stackDouble();

    expect(() => zkPassportMethod(double.stack).signingInput(makeCtx(CONFIG, digest as Hex), PARAMS)).toThrow();
    expect(double.calls).toEqual([]);
  });
});
