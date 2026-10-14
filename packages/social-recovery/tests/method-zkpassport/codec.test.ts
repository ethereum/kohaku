import { describe, expect, it } from 'vitest';
import { zkPassportMethod } from '../../src/method-zkpassport';
import type { Fields, Hex } from '../../src/interfaces';
import { readVector } from '../kat/read-vector';
import {
  asHex,
  asText,
  encodeConfig,
  encodeFiveFieldConfig,
  encodeNestedConfig,
  encodeProof,
  isArgumentError,
  member,
  readPinConfigRows,
  sparse,
  stackDouble,
  thrown,
  word,
} from './fixtures';

const blessedConfigFile = readVector('method-zkpassport-config.json');
const configFile = readPinConfigRows();
const proofFile = readVector('method-zkpassport-proof.json');

const { codec } = zkPassportMethod(stackDouble().stack);

const configFields = (input: unknown): Fields => ({
  uniqueIdentifier: asHex(member(input, 'uniqueIdentifier')),
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
const rows = (file: typeof proofFile) => file.vectors.map((row) => [asText(row['id']), row] as const);

describe('the config rows of the contracts pin\'s layout, replayed through the codec', () => {
  it('the tester-authored rows are the pin\'s flat four-field layout, not blessed', () => {
    expect(configFile.format).toBe('method-zkpassport-config-v2');
    expect(configFile['blessed']).toBe(false);
    expect(configFile.derivation).toBe('abi.encode(bytes32 uniqueIdentifier, string domain, string scope, uint256 validityPeriodInSeconds)');
    expect(rows(configFile).map(([name]) => name)).toContain('normal');
    expect(rows(configFile).length).toBeGreaterThan(1);
  });

  describe.each(rows(configFile))('config row %s', (_name, row) => {
    const fields = configFields(row['input']);
    const expected = asHex(member(row, 'expected', 'encoded'));

    it('encodes byte for byte', () => {
      expect(codec.encodeConfig(fields)).toBe(expected);
    });

    it('the independent viem encoding of the pin\'s signature agrees (the row is self-consistent)', () => {
      const f = fields as { uniqueIdentifier: Hex; domain: string; scope: string; validityPeriodInSeconds: bigint };

      expect(encodeConfig(f.uniqueIdentifier, f.domain, f.scope, f.validityPeriodInSeconds)).toBe(expected);
    });

    it('decodes to exactly the four row inputs, no version, and re-encodes to the same bytes', () => {
      const decoded = codec.decodeConfig(expected);

      expect(Object.keys(decoded).sort()).toEqual(['domain', 'scope', 'uniqueIdentifier', 'validityPeriodInSeconds']);
      expect(String(decoded['uniqueIdentifier']).toLowerCase()).toBe(String(fields['uniqueIdentifier']).toLowerCase());
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

    it('refuses the same fields as the five-field layout with a version word, and as a nested tuple', () => {
      const f = fields as { uniqueIdentifier: Hex; domain: string; scope: string; validityPeriodInSeconds: bigint };

      expect(() => codec.decodeConfig(encodeFiveFieldConfig(f.uniqueIdentifier, word(0x14), f.domain, f.scope, f.validityPeriodInSeconds))).toThrow();
      expect(() => codec.decodeConfig(encodeNestedConfig(f.uniqueIdentifier, f.domain, f.scope, f.validityPeriodInSeconds))).toThrow();
    });
  });

  it('the row "normal" is the pin\'s own vector: the domain offset is 0x80, four head words', () => {
    const normal = rows(configFile).find(([name]) => name === 'normal');
    const bytes = asHex(member(normal?.[1], 'expected', 'encoded')).slice(2);

    expect(BigInt(`0x${bytes.slice(64, 128)}`)).toBe(0x80n);
    expect(BigInt(`0x${bytes.slice(128, 192)}`)).toBe(0xc0n);
  });

  it('refuses dirty padding after the domain text', () => {
    const expected = encodeConfig(word(7), 'recover.example', 's', 1n);
    // The domain's text starts at 0xa0 (after 4 head words and its length word); its padding ends at 0xc0.
    const bytes = expected.slice(2);
    const lastPadByte = (0xc0 - 1) * 2;
    const dirty = `0x${bytes.slice(0, lastPadByte)}01${bytes.slice(lastPadByte + 2)}` as Hex;

    expect(dirty.length).toBe(expected.length);
    expect(() => codec.decodeConfig(dirty)).toThrow();
  });

  it('refuses every row of the blessed five-field copy, which the pin no longer decodes', () => {
    expect(blessedConfigFile.format).toBe('method-zkpassport-config-v1');

    for (const [, row] of rows(blessedConfigFile)) {
      const bytes = asHex(member(row, 'expected', 'encoded'));

      expect(isArgumentError(thrown(() => codec.decodeConfig(bytes)))).toBe(true);
    }
  });

  it('encodeConfig refuses the blessed copy\'s five-field input (a version member) with a TypeError', () => {
    for (const [, row] of rows(blessedConfigFile)) {
      const input = row['input'];
      const fields: Fields = {
        ...configFields(input),
        version: asHex(member(input, 'version')),
      };

      expect(() => codec.encodeConfig(fields)).toThrow(TypeError);
    }
  });
});

describe('the blessed proof vectors, replayed through the codec', () => {
  it('the proof file is the format this method reads, with the derivation it states', () => {
    expect(proofFile.format).toBe('method-zkpassport-proof-v1');
    expect(proofFile.derivation).toBe(
      'abi.encode(ProofVerificationData(bytes32 vkeyHash,bytes proof,bytes32[] publicInputs), bytes committedInputs)',
    );
    expect(rows(proofFile).length).toBeGreaterThan(0);
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
    domain: 'recover.example',
    scope: 'scope',
    validityPeriodInSeconds: 3600n,
  };

  const proof: Fields = {
    proofVerificationData: { vkeyHash: word(1), proof: '0x01', publicInputs: [word(0), word(7), word(0)] },
    committedInputs: '0x',
  };

  /** A proof whose public inputs are the given list, holes kept. */
  const withInputs = (publicInputs: unknown): Fields => ({
    proofVerificationData: { vkeyHash: word(1), proof: '0x', publicInputs: publicInputs as Hex[] },
    committedInputs: '0x',
  });

  it('round-trips its own encodings (a baseline for the refusals)', () => {
    expect(codec.encodeConfig(codec.decodeConfig(codec.encodeConfig(config)))).toBe(codec.encodeConfig(config));
    expect(codec.encodeProof(codec.decodeProof(codec.encodeProof(proof)))).toBe(codec.encodeProof(proof));
  });

  it.each([
    ['a 31-byte identifier', { ...config, uniqueIdentifier: `0x${'11'.repeat(31)}` }],
    ['a 33-byte identifier', { ...config, uniqueIdentifier: `0x${'11'.repeat(33)}` }],
    ['a non-hex identifier', { ...config, uniqueIdentifier: `0x${'zz'.repeat(32)}` }],
    ['an identifier without 0x', { ...config, uniqueIdentifier: '11'.repeat(32) }],
    ['a domain that is not text', { ...config, domain: 5 }],
    ['a scope that is not text', { ...config, scope: null }],
    ['a validity that is decimal text', { ...config, validityPeriodInSeconds: '3600' }],
    ['a missing field', { uniqueIdentifier: word(7), domain: 'd', scope: 's' }],
    ['an extra field', { ...config, extra: 'x' }],
    ['a version field, the superseded layout', { ...config, version: word(1) }],
    ['fields that are not a record', null],
  ])('encodeConfig refuses %s with a TypeError', (_why, fields) => {
    expect(() => codec.encodeConfig(fields as Fields)).toThrow(TypeError);
  });

  it.each([
    ['a negative validity', -1n],
    ['a validity of 2^256, one over uint256', 1n << 256n],
    ['a validity far over uint256', 1n << 300n],
  ])('encodeConfig refuses %s with a RangeError', (_why, validity) => {
    expect(() => codec.encodeConfig({ ...config, validityPeriodInSeconds: validity })).toThrow(RangeError);
  });

  it('encodeConfig takes the largest uint256 validity', () => {
    const max = (1n << 256n) - 1n;

    expect(codec.encodeConfig({ ...config, validityPeriodInSeconds: max })).toBe(encodeConfig(word(7), 'recover.example', 'scope', max));
  });

  it('an empty domain is the pin\'s layout too: encoded as viem encodes it, and decoded back', () => {
    const empty = encodeConfig(word(7), '', 'scope', 3600n);

    expect(codec.encodeConfig({ ...config, domain: '' })).toBe(empty);
    expect(codec.decodeConfig(empty)).toEqual({ ...config, domain: '' });
  });

  it.each([
    ['a 31-byte vkeyHash', { ...proof, proofVerificationData: { vkeyHash: `0x${'11'.repeat(31)}`, proof: '0x01', publicInputs: [] } }],
    ['a 33-byte public input', withInputs([`0x${'11'.repeat(33)}`])],
    ['a 31-byte public input', withInputs([`0x${'11'.repeat(31)}`])],
    ['odd-length proof bytes', { ...proof, proofVerificationData: { vkeyHash: word(1), proof: '0x123', publicInputs: [] } }],
    ['odd-length committed inputs', { ...proof, committedInputs: '0x1' }],
    ['public inputs that are not a list', withInputs(word(1))],
    ['proof data that is not a record', { ...proof, proofVerificationData: 'x' }],
    ['a missing committedInputs', { proofVerificationData: proof['proofVerificationData'] }],
    ['an extra field', { ...proof, extra: '0x' }],
  ])('encodeProof refuses %s with a TypeError or a RangeError, never a plain Error', (_why, fields) => {
    expect(isArgumentError(thrown(() => codec.encodeProof(fields as Fields)))).toBe(true);
  });

  it.each([
    ['in the middle', sparse(3, { 0: word(1), 2: word(2) }), 1],
    ['first', sparse(2, { 1: word(1) }), 0],
    ['last, a trailing hole', sparse(3, { 0: word(1), 1: word(2) }), 2],
    ['an array of length 3 with no entries', sparse(3, {}), 0],
  ])('encodeProof refuses a hole in publicInputs %s with a TypeError naming the position', (_why, inputs, position) => {
    const error = thrown(() => codec.encodeProof(withInputs(inputs)));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain(`publicInputs[${position}]`);
  });

  it('encodeProof refuses an explicit undefined public input with a TypeError naming the position', () => {
    const error = thrown(() => codec.encodeProof(withInputs([word(1), undefined])));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('[1]');
  });

  it.each([
    ['empty bytes', '0x'],
    ['not hex', '0xzz'],
    ['an odd nibble count', '0x123'],
    ['one word', word(1)],
  ])('decodeConfig and decodeProof refuse %s with a TypeError or a RangeError', (_why, bytes) => {
    expect(isArgumentError(thrown(() => codec.decodeConfig(bytes as Hex)))).toBe(true);
    expect(isArgumentError(thrown(() => codec.decodeProof(bytes as Hex)))).toBe(true);
  });

  it('decodeConfig refuses a domain that is not valid UTF-8 (bytes its encode would not reproduce)', () => {
    const good = encodeConfig(word(7), 'ab', 's', 1n).slice(2);
    // The domain text begins at 0xa0: replace "ab" (6162) by ff ff.
    const at = 0xa0 * 2;
    const bad = `0x${good.slice(0, at)}ffff${good.slice(at + 4)}` as Hex;

    expect(() => codec.decodeConfig(bad)).toThrow();
  });

  it('decodeConfig refuses proof bytes and decodeProof refuses config bytes', () => {
    expect(() => codec.decodeConfig(codec.encodeProof(proof))).toThrow();
    expect(() => codec.decodeProof(codec.encodeConfig(config))).toThrow();
  });
});
