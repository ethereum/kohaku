import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { configBytes, configRow, FRESHNESS_WINDOW, MIN_FRESHNESS_WINDOW, stackDouble } from './fixtures';

const { codec } = anonAadhaarMethod({ stack: stackDouble().stack });

/** The BN254 scalar field the pinned Groth16 verifier checks every public input against, written out here. */
const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const WORD_MAX = (1n << 256n) - 1n;

/** What the codec says its module refuses at every proof; a codec without the hook fails the test. */
const outOfBounds = (config: Hex): readonly string[] => {
  if (codec.outOfBounds === undefined) throw new Error('the Aadhaar codec declares no outOfBounds');

  return codec.outOfBounds(config);
};

const ROWS: readonly (readonly [string, bigint, bigint, bigint, readonly string[]])[] = [
  ['a window one second under the hour', 22n, 77n, MIN_FRESHNESS_WINDOW - 1n, ['freshnessWindow']],
  ['a zero window', 22n, 77n, 0n, ['freshnessWindow']],
  ['a window of exactly one hour', 22n, 77n, MIN_FRESHNESS_WINDOW, []],
  ['the 24-hour window enrollment writes', 22n, 77n, FRESHNESS_WINDOW, []],
  ['the largest word as the window, the module having no maximum', 22n, 77n, WORD_MAX, []],
  ['a nullifier equal to the field', R, 77n, FRESHNESS_WINDOW, ['nullifier']],
  ['the largest word as the nullifier', WORD_MAX, 77n, FRESHNESS_WINDOW, ['nullifier']],
  ['the largest nullifier inside the field', R - 1n, 77n, FRESHNESS_WINDOW, []],
  ['a zero nullifier, which no rule refuses', 0n, 77n, FRESHNESS_WINDOW, []],
  ['a seed equal to the field', 22n, R, FRESHNESS_WINDOW, ['nullifierSeed']],
  ['the largest seed inside the field', 22n, R - 1n, FRESHNESS_WINDOW, []],
  ['a nullifier and a window out of bounds', R, 77n, 0n, ['nullifier', 'freshnessWindow']],
  ['every field out of bounds at once', R, R + 1n, MIN_FRESHNESS_WINDOW - 1n, ['nullifier', 'nullifierSeed', 'freshnessWindow']],
];

describe('the Aadhaar codec\'s outOfBounds', () => {
  it.each(ROWS)('%s answers the refused fields in layout order', (_why, nullifier, nullifierSeed, freshnessWindow, fields) => {
    expect(outOfBounds(configBytes(nullifier, nullifierSeed, freshnessWindow))).toEqual(fields);
  });

  it('the vector row is inside every bound', () => {
    expect(outOfBounds(configRow.expected.encoded)).toEqual([]);
  });

  it('a config out of bounds still encodes and decodes, the layout being decodeConfig\'s alone', () => {
    const fields = { nullifier: R, nullifierSeed: 77n, freshnessWindow: 1n };
    const config = codec.encodeConfig(fields);

    expect(config).toBe(configBytes(R, 77n, 1n));
    expect(codec.decodeConfig(config)).toEqual(fields);
    expect(outOfBounds(config)).toEqual(['nullifier', 'freshnessWindow']);
  });
});
