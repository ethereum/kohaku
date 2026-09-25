import { describe, expect, it } from 'vitest';
import { zkPassportMethod } from '../../src/method-zkpassport';
import type { Fields, Hex } from '../../src/interfaces';
import { readVector } from '../kat/read-vector';
import { asHex, asText, encodeConfig, encodeProof, member, stackDouble, word } from './fixtures';

const configFile = readVector('method-zkpassport-config.json');
const proofFile = readVector('method-zkpassport-proof.json');

const { codec } = zkPassportMethod(stackDouble().stack);

const configFields = (input: unknown): Fields => ({
  uniqueIdentifier: asHex(member(input, 'uniqueIdentifier')),
  version: asHex(member(input, 'version')),
  domain: asText(member(input, 'domain')),
  scope: asText(member(input, 'scope')),
  validityPeriodInSeconds: BigInt(asText(member(input, 'validityPeriodInSeconds'))),
});

const proofFields = (input: unknown): Fields => {
  const inputs = member(input, 'proofVerificationData', 'publicInputs');

  if (!Array.isArray(inputs)) throw new Error('vector row without publicInputs');

  return {
    proofVerificationData: {
      vkeyHash: asHex(member(input, 'proofVerificationData', 'vkeyHash')),
      proof: asHex(member(input, 'proofVerificationData', 'proof')),
      publicInputs: inputs.map(asHex),
    },
    committedInputs: asHex(member(input, 'committedInputs')),
  };
};

/** The vector rows by their `id`, read by bracket so no identifier is named `id`. */
const rows = (file: typeof configFile) => file.vectors.map((row) => [asText(row['id']), row] as const);

describe('the blessed vectors, replayed through the codec', () => {
  it('the files are the formats this method reads, with the derivations they state', () => {
    expect(configFile.format).toBe('method-zkpassport-config-v1');
    expect(configFile.derivation).toBe(
      'abi.encode(bytes32 uniqueIdentifier, bytes32 version, string domain, string scope, uint256 validityPeriodInSeconds)',
    );
    expect(proofFile.format).toBe('method-zkpassport-proof-v1');
    expect(proofFile.derivation).toBe(
      'abi.encode(ProofVerificationData(bytes32 vkeyHash,bytes proof,bytes32[] publicInputs), bytes committedInputs)',
    );
    expect(rows(configFile).length).toBeGreaterThan(0);
    expect(rows(proofFile).length).toBeGreaterThan(0);
  });

  describe.each(rows(configFile))('config row %s', (_name, row) => {
    const fields = configFields(row['input']);
    const expected = asHex(member(row, 'expected', 'encoded'));

    it('encodes byte for byte', () => {
      expect(codec.encodeConfig(fields)).toBe(expected);
    });

    it('the independent viem encoding of the stated derivation agrees (the row is self-consistent)', () => {
      const f = fields as { uniqueIdentifier: Hex; version: Hex; domain: string; scope: string; validityPeriodInSeconds: bigint };

      expect(encodeConfig(f.uniqueIdentifier, f.version, f.domain, f.scope, f.validityPeriodInSeconds)).toBe(expected);
    });

    it('decodes to exactly the row inputs and re-encodes to the same bytes', () => {
      const decoded = codec.decodeConfig(expected);

      expect(Object.keys(decoded).sort()).toEqual(Object.keys(fields).sort());
      expect(String(decoded['uniqueIdentifier']).toLowerCase()).toBe(String(fields['uniqueIdentifier']).toLowerCase());
      expect(String(decoded['version']).toLowerCase()).toBe(String(fields['version']).toLowerCase());
      expect(decoded['domain']).toBe(fields['domain']);
      expect(decoded['scope']).toBe(fields['scope']);
      expect(BigInt(decoded['validityPeriodInSeconds'] as bigint)).toBe(fields['validityPeriodInSeconds']);
      expect(codec.encodeConfig(decoded)).toBe(expected);
    });

    it('refuses the row with a trailing byte, one byte short, or a trailing zero word', () => {
      expect(() => codec.decodeConfig(`${expected}00`)).toThrow();
      expect(() => codec.decodeConfig(expected.slice(0, -2) as Hex)).toThrow();
      expect(() => codec.decodeConfig(`${expected}${'0'.repeat(64)}`)).toThrow();
    });

    it('refuses dirty padding after the domain text', () => {
      // The domain's text starts at 0xc0 (after 5 head words and its length word); its padding ends at 0xe0.
      const bytes = expected.slice(2);
      const lastPadByte = (0xe0 - 1) * 2;
      const dirty = `0x${bytes.slice(0, lastPadByte)}01${bytes.slice(lastPadByte + 2)}` as Hex;

      expect(dirty.length).toBe(expected.length);
      expect(() => codec.decodeConfig(dirty)).toThrow();
    });
  });

  describe.each(rows(proofFile))('proof row %s', (_name, row) => {
    const fields = proofFields(row['input']);
    const expected = asHex(member(row, 'expected', 'encoded'));

    it('encodes byte for byte', () => {
      expect(codec.encodeProof(fields)).toBe(expected);
    });

    it('the independent viem encoding of the stated derivation agrees', () => {
      const data = fields['proofVerificationData'] as { vkeyHash: Hex; proof: Hex; publicInputs: Hex[] };

      expect(encodeProof(data.vkeyHash, data.proof, data.publicInputs, fields['committedInputs'] as Hex)).toBe(expected);
    });

    it('decodes to exactly the row inputs and re-encodes to the same bytes', () => {
      const decoded = codec.decodeProof(expected);
      const data = decoded['proofVerificationData'] as { [k: string]: unknown };
      const want = fields['proofVerificationData'] as { [k: string]: unknown };

      expect(Object.keys(decoded).sort()).toEqual(['committedInputs', 'proofVerificationData']);
      expect(Object.keys(data).sort()).toEqual(['proof', 'publicInputs', 'vkeyHash']);
      expect(String(data['vkeyHash']).toLowerCase()).toBe(String(want['vkeyHash']).toLowerCase());
      expect(String(data['proof']).toLowerCase()).toBe(String(want['proof']).toLowerCase());
      expect((data['publicInputs'] as string[]).map((v) => v.toLowerCase())).toEqual(
        (want['publicInputs'] as string[]).map((v) => v.toLowerCase()),
      );
      expect(String(decoded['committedInputs']).toLowerCase()).toBe(String(fields['committedInputs']).toLowerCase());
      expect(codec.encodeProof(decoded)).toBe(expected);
    });

    it('refuses the row with a trailing byte or one byte short', () => {
      expect(() => codec.decodeProof(`${expected}00`)).toThrow();
      expect(() => codec.decodeProof(expected.slice(0, -2) as Hex)).toThrow();
    });

    it('refuses a non-canonical head offset', () => {
      // The committedInputs offset is the second head word; point it one word further.
      const bytes = expected.slice(2);
      const offset = BigInt(`0x${bytes.slice(64, 128)}`);
      const moved = `0x${bytes.slice(0, 64)}${(offset + 32n).toString(16).padStart(64, '0')}${bytes.slice(128)}${'0'.repeat(64)}`;

      expect(() => codec.decodeProof(moved as Hex)).toThrow();
    });

    it('the row binds the digest in the one text rendering, and names the non-salted nullifier type three from the end', () => {
      const digest = asHex(member(row, 'input', 'digest'));
      const inputs = (fields['proofVerificationData'] as { publicInputs: Hex[] }).publicInputs;
      const index = Number(member(row, 'expected', 'nullifierTypeIndexFromEnd'));

      expect(member(row, 'expected', 'requiredCustomData')).toMatch(/^0x[0-9a-f]{64}$/);
      expect(member(row, 'expected', 'requiredCustomData')).toBe(digest.toLowerCase());
      expect(member(row, 'expected', 'nullifierType')).toMatch(/^0 NON_SALTED_NULLIFIER$/);
      expect(BigInt(inputs[inputs.length - index] ?? '0x1')).toBe(0n);
    });
  });
});

describe('the codec refuses what its layouts do not hold', () => {
  const config: Fields = {
    uniqueIdentifier: word(7),
    version: word(1),
    domain: 'recover.example',
    scope: 'scope',
    validityPeriodInSeconds: 3600n,
  };

  const proof: Fields = {
    proofVerificationData: { vkeyHash: word(1), proof: '0x01', publicInputs: [word(0), word(7), word(0)] },
    committedInputs: '0x',
  };

  it('round-trips its own encodings (a baseline for the refusals)', () => {
    expect(codec.encodeConfig(codec.decodeConfig(codec.encodeConfig(config)))).toBe(codec.encodeConfig(config));
    expect(codec.encodeProof(codec.decodeProof(codec.encodeProof(proof)))).toBe(codec.encodeProof(proof));
  });

  it.each([
    ['a 31-byte identifier', { ...config, uniqueIdentifier: `0x${'11'.repeat(31)}` }],
    ['a 33-byte identifier', { ...config, uniqueIdentifier: `0x${'11'.repeat(33)}` }],
    ['a 31-byte version', { ...config, version: `0x${'11'.repeat(31)}` }],
    ['a non-hex identifier', { ...config, uniqueIdentifier: `0x${'zz'.repeat(32)}` }],
    ['a negative validity', { ...config, validityPeriodInSeconds: -1n }],
    ['a validity of 2^256', { ...config, validityPeriodInSeconds: 1n << 256n }],
    ['a domain that is not text', { ...config, domain: 5 }],
    ['a missing field', { uniqueIdentifier: word(7), version: word(1), domain: 'd', scope: 's' }],
    ['an extra field', { ...config, extra: 'x' }],
  ])('encodeConfig refuses %s', (_why, fields) => {
    expect(() => codec.encodeConfig(fields as Fields)).toThrow();
  });

  it.each([
    ['a 31-byte vkeyHash', { ...proof, proofVerificationData: { vkeyHash: `0x${'11'.repeat(31)}`, proof: '0x01', publicInputs: [] } }],
    ['a 33-byte public input', { ...proof, proofVerificationData: { vkeyHash: word(1), proof: '0x01', publicInputs: [`0x${'11'.repeat(33)}`] } }],
    ['odd-length proof bytes', { ...proof, proofVerificationData: { vkeyHash: word(1), proof: '0x123', publicInputs: [] } }],
    ['odd-length committed inputs', { ...proof, committedInputs: '0x1' }],
    ['public inputs that are not a list', { ...proof, proofVerificationData: { vkeyHash: word(1), proof: '0x', publicInputs: word(1) } }],
    ['a missing committedInputs', { proofVerificationData: proof['proofVerificationData'] }],
    ['an extra field', { ...proof, extra: '0x' }],
  ])('encodeProof refuses %s', (_why, fields) => {
    expect(() => codec.encodeProof(fields as Fields)).toThrow();
  });

  it.each([
    ['empty bytes', '0x'],
    ['not hex', '0xzz'],
    ['an odd nibble count', '0x123'],
    ['one word', word(1)],
  ])('decodeConfig and decodeProof refuse %s', (_why, bytes) => {
    expect(() => codec.decodeConfig(bytes as Hex)).toThrow();
    expect(() => codec.decodeProof(bytes as Hex)).toThrow();
  });

  it('decodeConfig refuses a domain that is not valid UTF-8 (bytes its encode would not reproduce)', () => {
    const good = encodeConfig(word(7), word(1), 'ab', 's', 1n).slice(2);
    // The domain text begins at 0xc0: replace "ab" (6162) by ff ff.
    const at = 0xc0 * 2;
    const bad = `0x${good.slice(0, at)}ffff${good.slice(at + 4)}` as Hex;

    expect(() => codec.decodeConfig(bad)).toThrow();
  });

  it('decodeConfig refuses proof bytes and decodeProof refuses config bytes', () => {
    expect(() => codec.decodeConfig(codec.encodeProof(proof))).toThrow();
    expect(() => codec.decodeProof(codec.encodeConfig(config))).toThrow();
  });
});
