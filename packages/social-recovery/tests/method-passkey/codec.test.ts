import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import { readVector } from '../kat/read-vector';
import {
  bytesOf,
  CONFIG_FILE,
  type ConfigVectorFile,
  configBytes,
  HALF_N,
  hexOf,
  N,
  PROOF_FILE,
  type ProofVectorFile,
  proofBytes,
  sha256,
} from './fixtures';

const { codec } = passkeyMethod();
const configFile = readVector(CONFIG_FILE) as unknown as ConfigVectorFile;
const proofFile = readVector(PROOF_FILE) as unknown as ProofVectorFile;

describe(`${CONFIG_FILE} (blessed copy)`, () => {
  const rows = configFile.vectors;

  it('holds at least one row, so the replay is not vacuous', () => {
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  for (const row of rows) {
    it(`${row['id']}: rpIdHash is sha256 of the rp id`, () => {
      expect(hexOf(sha256(row.input.rpId))).toBe(row.input.rpIdHash.toLowerCase());
    });

    it(`${row['id']}: encodeConfig reproduces the expected bytes`, () => {
      const encoded = codec.encodeConfig({ x: BigInt(row.input.x), y: BigInt(row.input.y), rpIdHash: row.input.rpIdHash });

      expect(encoded).toBe(row.expected.encoded.toLowerCase());
    });

    it(`${row['id']}: decodeConfig returns the three fields`, () => {
      expect(codec.decodeConfig(row.expected.encoded)).toEqual({
        x: BigInt(row.input.x),
        y: BigInt(row.input.y),
        rpIdHash: row.input.rpIdHash.toLowerCase(),
      });
    });
  }
});

describe(`${PROOF_FILE} (blessed copy)`, () => {
  const rows = proofFile.vectors;

  it('holds the six rows the file names', () => {
    expect(rows.map((row) => row['id'])).toEqual([
      'valid-extra-client-field',
      'missing-user-verification',
      'missing-user-presence',
      'wrong-challenge',
      'wrong-client-data-type',
      'wrong-relying-party-hash',
    ]);
  });

  for (const row of rows) {
    const fields = {
      authenticatorData: row.input.authenticatorData.toLowerCase(),
      clientDataJSON: row.input.clientDataJSON,
      r: BigInt(row.input.r),
      s: BigInt(row.input.s),
    };

    it(`${row['id']}: encodeProof reproduces the expected bytes`, () => {
      expect(codec.encodeProof(fields)).toBe(row.expected.encoded.toLowerCase());
    });

    it(`${row['id']}: decodeProof returns the four fields`, () => {
      expect(codec.decodeProof(row.expected.encoded)).toEqual(fields);
    });

    it(`${row['id']}: signedHash is sha256(authenticatorData || sha256(clientDataJSON))`, () => {
      const message = new Uint8Array([
        ...bytesOf(row.input.authenticatorData),
        ...sha256(row.input.clientDataJSON),
      ]);

      expect(hexOf(sha256(message))).toBe(row.expected.signedHash.toLowerCase());
    });
  }
});

describe('config layout, fresh values', () => {
  const x = 0x1234n;
  const y = N - 1n;
  const rpIdHash = hexOf(sha256('wallet.example'));

  it('is three static words, x then y then rpIdHash, 96 bytes', () => {
    const encoded = codec.encodeConfig({ x, y, rpIdHash });

    expect(encoded).toBe(configBytes(x, y, rpIdHash));
    expect((encoded.length - 2) / 2).toBe(96);
    expect(encoded.slice(2 + 128)).toBe(rpIdHash.slice(2));
  });

  it('carries no relying-party id, only its hash', () => {
    const encoded = codec.encodeConfig({ x, y, rpIdHash });

    expect(encoded).not.toContain(Buffer.from('wallet.example').toString('hex'));
  });

  it('decode refuses bytes that are not exactly three words', () => {
    const encoded = configBytes(x, y, rpIdHash);

    expect(() => codec.decodeConfig(`${encoded}00`)).toThrow();
    expect(() => codec.decodeConfig(encoded.slice(0, -2) as `0x${string}`)).toThrow();
    expect(() => codec.decodeConfig('0x')).toThrow();
  });

  it('encode refuses missing, extra or out-of-range fields', () => {
    expect(() => codec.encodeConfig({ x, y })).toThrow();
    expect(() => codec.encodeConfig({ x, y, rpIdHash, rpId: 'wallet.example' })).toThrow();
    expect(() => codec.encodeConfig({ x: 1n << 256n, y, rpIdHash })).toThrow();
    expect(() => codec.encodeConfig({ x, y, rpIdHash: '0x1234' })).toThrow();
  });
});

describe('proof layout, fresh values', () => {
  const authenticatorData = `0x${'11'.repeat(32)}0500000001` as const;
  const clientDataJSON = '{"type":"webauthn.get","challenge":"AA","origin":"https://a.example","crossOrigin":false}';

  it('is (bytes, bytes, uint256, uint256) with the client data as its UTF-8 bytes', () => {
    const encoded = codec.encodeProof({ authenticatorData, clientDataJSON, r: 5n, s: 7n });

    expect(encoded).toBe(proofBytes(authenticatorData, clientDataJSON, 5n, 7n));
  });

  it('accepts s at exactly n/2 and refuses s one above it', () => {
    expect(() => codec.encodeProof({ authenticatorData, clientDataJSON, r: 5n, s: HALF_N })).not.toThrow();
    expect(() => codec.encodeProof({ authenticatorData, clientDataJSON, r: 5n, s: HALF_N + 1n })).toThrow();
  });

  it('decode refuses a proof carrying a high s', () => {
    expect(() => codec.decodeProof(proofBytes(authenticatorData, clientDataJSON, 5n, N - 7n))).toThrow();
  });

  it('decode refuses bytes its encode would not reproduce: trailing bytes, dirty padding, a moved offset', () => {
    const encoded = proofBytes(authenticatorData, clientDataJSON, 5n, 7n);
    const body = encoded.slice(2);
    // The authenticator data's 37 bytes sit in a 64-byte tail word pair; its padding starts 37 bytes in.
    const tailStart = 2 * (4 * 32 + 32);
    const dirty = `0x${body.slice(0, tailStart + 74)}ff${body.slice(tailStart + 76)}` as const;
    const movedOffset = `0x${body.slice(0, 62)}a0${body.slice(64)}` as const;

    expect(() => codec.decodeProof(`${encoded}00`)).toThrow();
    expect(() => codec.decodeProof(dirty)).toThrow();
    expect(() => codec.decodeProof(movedOffset)).toThrow();
  });

  it('decode refuses client data that is not UTF-8', () => {
    // The same layout by hand, with one invalid UTF-8 byte (0xff) as the client data.
    const handBuilt = `0x${[
      (0x80).toString(16).padStart(64, '0'),
      (0x80 + 32 + 64).toString(16).padStart(64, '0'),
      (5).toString(16).padStart(64, '0'),
      (7).toString(16).padStart(64, '0'),
      (37).toString(16).padStart(64, '0'),
      `${'11'.repeat(32)}0500000001`.padEnd(128, '0'),
      (1).toString(16).padStart(64, '0'),
      'ff'.padEnd(64, '0'),
    ].join('')}` as const;

    expect(() => codec.decodeProof(handBuilt)).toThrow();
  });

  it('encode refuses missing or extra fields', () => {
    expect(() => codec.encodeProof({ authenticatorData, clientDataJSON, r: 5n })).toThrow();
    expect(() => codec.encodeProof({ authenticatorData, clientDataJSON, r: 5n, s: 7n, v: 1n })).toThrow();
  });

  it('round-trips an s at n/2 and an r at n-1', () => {
    const fields = { authenticatorData, clientDataJSON, r: N - 1n, s: HALF_N };

    expect(codec.decodeProof(codec.encodeProof(fields))).toEqual(fields);
  });
});
