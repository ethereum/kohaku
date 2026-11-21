import { describe, expect, it } from 'vitest';
import * as core from '../../src';
import { METHOD_ZKPASSPORT_MAX_VALIDITY, METHOD_ZKPASSPORT_MIN_VALIDITY } from '../../src/constants/method-zkpassport';
import type { Hex } from '../../src/interfaces';
import { zkPassportMethod } from '../../src/method-zkpassport';
import { readVector } from '../kat/read-vector';
import { encodeConfig, word } from './fixtures';

const { codec } = zkPassportMethod();

const WORD_MAX = (1n << 256n) - 1n;

const IDENTIFIER: Hex = word(0x7b);

/** What the codec says its module refuses at every proof; a codec without the hook fails the test. */
const outOfBounds = (config: Hex): readonly string[] => {
  if (codec.outOfBounds === undefined) throw new Error('the zkPassport codec declares no outOfBounds');

  return codec.outOfBounds(config);
};

const ROWS: readonly (readonly [string, Hex, string, string, bigint, readonly string[]])[] = [
  ['a zero identifier', word(0), 'recover.example', 'social-recovery', 86_400n, ['uniqueIdentifier']],
  ['the all-ones identifier, its circuit field not judged', word(WORD_MAX), 'recover.example', 'social-recovery', 86_400n, []],
  ['a zero period', IDENTIFIER, 'recover.example', 'social-recovery', 0n, ['validityPeriodInSeconds']],
  ['a period of one second', IDENTIFIER, 'recover.example', 'social-recovery', 1n, []],
  ['the 604,800-second period enrollment writes', IDENTIFIER, 'recover.example', 'social-recovery', 604_800n, []],
  ['the largest safe-integer period', IDENTIFIER, 'recover.example', 'social-recovery', 2n ** 53n - 1n, []],
  ['a period of 2^53 seconds', IDENTIFIER, 'recover.example', 'social-recovery', 2n ** 53n, ['validityPeriodInSeconds']],
  ['the largest word as the period', IDENTIFIER, 'recover.example', 'social-recovery', WORD_MAX, ['validityPeriodInSeconds']],
  ['an empty domain and scope, neither judged', IDENTIFIER, '', '', 86_400n, []],
  ['a zero identifier and a zero period', word(0), 'recover.example', 'social-recovery', 0n, ['uniqueIdentifier', 'validityPeriodInSeconds']],
];

describe('the zkPassport codec\'s outOfBounds', () => {
  it.each(ROWS)('%s answers the refused fields in layout order', (_why, identifier, domain, scope, period, fields) => {
    expect(outOfBounds(encodeConfig(identifier, domain, scope, period))).toEqual(fields);
  });

  it('the vector row is inside every bound', () => {
    const row = readVector('method-zkpassport-config.json').vectors[0];

    expect(outOfBounds((row?.expected as { readonly encoded: Hex }).encoded)).toEqual([]);
  });

  it('a config out of bounds still encodes and decodes, the layout being decodeConfig\'s alone', () => {
    const fields = { uniqueIdentifier: word(0), domain: 'recover.example', scope: 'social-recovery', validityPeriodInSeconds: 0n };
    const config = codec.encodeConfig(fields);

    expect(config).toBe(encodeConfig(word(0), 'recover.example', 'social-recovery', 0n));
    expect(codec.decodeConfig(config)).toEqual(fields);
    expect(outOfBounds(config)).toEqual(['uniqueIdentifier', 'validityPeriodInSeconds']);
  });
});

describe('the supported validity range', () => {
  it('runs from one second to 2^53 - 1 seconds, the largest period the stack\'s number type holds exactly', () => {
    expect(METHOD_ZKPASSPORT_MIN_VALIDITY).toBe(1n);
    expect(METHOD_ZKPASSPORT_MAX_VALIDITY).toBe(9_007_199_254_740_991n);
    expect(METHOD_ZKPASSPORT_MAX_VALIDITY).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it('both ends are exported from the core entry as the same values', () => {
    expect(core.METHOD_ZKPASSPORT_MIN_VALIDITY).toBe(METHOD_ZKPASSPORT_MIN_VALIDITY);
    expect(core.METHOD_ZKPASSPORT_MAX_VALIDITY).toBe(METHOD_ZKPASSPORT_MAX_VALIDITY);
  });
});
