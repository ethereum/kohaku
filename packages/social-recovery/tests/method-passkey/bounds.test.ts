import * as P256 from 'ox/P256';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import type { Hex } from '../../src/interfaces';
import { readVector } from '../kat/read-vector';
import { CONFIG_FILE, type ConfigVectorFile, configBytes, freshKey } from './fixtures';

const { codec } = passkeyMethod();
const configFile = readVector(CONFIG_FILE) as unknown as ConfigVectorFile;

/** The P-256 base field prime, written out here. */
const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;

/** The P-256 generator. */
const G = {
  x: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
  y: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
};

const RP_ID_HASH: Hex = `0x${'cd'.repeat(32)}`;

/** What the codec says its module refuses at every proof; a codec without the hook fails the test. */
const outOfBounds = (config: Hex): readonly string[] => {
  if (codec.outOfBounds === undefined) throw new Error('the passkey codec declares no outOfBounds');

  return codec.outOfBounds(config);
};

const OFF_CURVE: readonly (readonly [string, bigint, bigint])[] = [
  ['the point (1, 2), off the curve', 1n, 2n],
  ['the point (0, 0), the encoding of infinity', 0n, 0n],
  ['x equal to the field prime', P, G.y],
  ['y equal to the field prime', G.x, P],
  ['the generator\'s x with y one above its own', G.x, G.y + 1n],
  ['the largest word in both coordinates', (1n << 256n) - 1n, (1n << 256n) - 1n],
];

describe('the passkey codec\'s outOfBounds', () => {
  it.each(OFF_CURVE)('%s refuses both coordinates', (_why, x, y) => {
    expect(outOfBounds(configBytes(x, y, RP_ID_HASH))).toEqual(['x', 'y']);
  });

  it('the vector row is inside every bound', () => {
    expect(configFile.vectors.length).toBeGreaterThanOrEqual(1);

    for (const row of configFile.vectors) expect(outOfBounds(row.expected.encoded), row['id']).toEqual([]);
  });

  it.each([
    ['the generator', G],
    ['the generator\'s negation', { x: G.x, y: P - G.y }],
    ['a point ox generates', P256.getPublicKey({ privateKey: P256.randomPrivateKey() })],
    ['a point node:crypto generates', freshKey()],
  ])('%s is a key the module can verify against, so nothing is refused', (_why, point) => {
    expect(outOfBounds(configBytes(point.x, point.y, RP_ID_HASH))).toEqual([]);
  });

  it('the rp id hash is not judged', () => {
    expect(outOfBounds(configBytes(G.x, G.y, `0x${'00'.repeat(32)}`))).toEqual([]);
  });

  it('a config out of bounds still encodes and decodes, the layout being decodeConfig\'s alone', () => {
    const fields = { x: 1n, y: 2n, rpIdHash: RP_ID_HASH };
    const config = codec.encodeConfig(fields);

    expect(config).toBe(configBytes(1n, 2n, RP_ID_HASH));
    expect(codec.decodeConfig(config)).toEqual(fields);
    expect(outOfBounds(config)).toEqual(['x', 'y']);
  });
});
