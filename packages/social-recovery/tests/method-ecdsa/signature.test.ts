import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/index';
import { normalizeSignature } from '../../src/method-ecdsa/signature';
import { readVector } from '../kat/read-vector';
import { expectedOf, rowName } from './fixtures';

const R = '9cc23b364d1bc8c5cc2100a486709fbeb2e4328cf3635788903fb1b4b92a8e59';

const LOW_S = '0ae8eda1f77fa8c62365613c80e78b243fe4b5269607974473eed59e631fb6db';

const HIGH_S = 'f517125e08805739dc9a9ec37f1874da7aca27c0194108f74be388ee6d168a66';

const ORDER = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';

/** The deterministic-test-key row's proof: key 0x01, low s, v = 27. */
const ROW_PROOF: Hex = `0x${R}${LOW_S}1b`;

/** Input and the exact bytes the hand-written codec returned for it, frozen before the switch to viem. */
const FROZEN: readonly (readonly [string, Hex, Hex])[] = [
  ['a low-s signature with v = 27', ROW_PROOF, ROW_PROOF],
  ['the same in upper-case hex', `0x${`${R}${LOW_S}1b`.toUpperCase()}`, ROW_PROOF],
  ['v = 0', `0x${R}${LOW_S}00`, `0x${R}${LOW_S}1b`],
  ['v = 1', `0x${R}${LOW_S}01`, `0x${R}${LOW_S}1c`],
  ['v = 28', `0x${R}${LOW_S}1c`, `0x${R}${LOW_S}1c`],
  ['v = 29, not a recovery byte', `0x${R}${LOW_S}1d`, `0x${R}${LOW_S}1d`],
  ['a high s with v = 28', `0x${R}${HIGH_S}1c`, `0x${R}${LOW_S}1b`],
  ['a high s with v = 27', `0x${R}${HIGH_S}1b`, `0x${R}${LOW_S}1c`],
  ['a high s with v = 1', `0x${R}${HIGH_S}01`, `0x${R}${LOW_S}1b`],
  ['s equal to the group order', `0x${R}${ORDER}1b`, `0x${R}${ORDER}1b`],
  ['empty bytes', '0x', '0x'],
  ['2 bytes', '0xBEEF', '0xbeef'],
  ['64 bytes', `0x${'33'.repeat(64)}`, `0x${'33'.repeat(64)}`],
  ['100 bytes', `0x${'A5'.repeat(100)}`, `0x${'a5'.repeat(100)}`],
];

describe('normalizeSignature gives the same bytes as before', () => {
  it.each(FROZEN)('%s', (_label, input, output) => {
    expect(normalizeSignature(input)).toBe(output);
  });

  it.each(readVector('method-ecdsa-proof.json').vectors.map((row) => [rowName(row), row] as const))(
    'row %s: the blessed proof comes back as it is',
    (_rowId, row) => {
      const proof = expectedOf(row)['proof'] as Hex;

      expect(normalizeSignature(proof)).toBe(proof);
    },
  );

  it('the frozen row proof is the one the vector blesses', () => {
    const row = readVector('method-ecdsa-proof.json').vectors.find((candidate) => rowName(candidate) === 'deterministic-test-key');

    expect(expectedOf(row)['proof']).toBe(ROW_PROOF);
  });
});
