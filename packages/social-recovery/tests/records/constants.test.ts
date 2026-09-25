import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { BODY_ENCODER_KEY, DIGEST_VERSION, POLICY_METHOD_VERIFY_ABI, VERDICT_MAGIC_VALUE } from '../../src/index';
import { keccak256Text, selectorOf } from '../helpers/keccak';
import { loadRecords, type RecordContext } from '../helpers/records';

const CONSTANTS = ['DIGEST_VERSION', 'BODY_ENCODER_KEY', 'POLICY_METHOD_VERIFY_ABI', 'VERDICT_MAGIC_VALUE'] as const;
const VERIFY_SIGNATURE = 'verify(bytes,bytes32,bytes)';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

let context: RecordContext;

beforeAll(() => {
  context = loadRecords();
});

describe('the Keccak-256 the magic value is checked with', () => {
  it.each([
    ['', '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
    ['abc', '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
  ])('replays the published vector for %j', (input, digest) => {
    expect(keccak256Text(input)).toBe(digest);
  });

  it('gives the ERC-20 transfer selector, 0xa9059cbb', () => {
    expect(selectorOf('transfer(address,uint256)')).toBe('0xa9059cbb');
  });

  it('pads across a block boundary: 136 and 300 bytes hash to 32 bytes of hex', () => {
    expect(keccak256Text('a'.repeat(136))).toMatch(/^0x[0-9a-f]{64}$/);
    expect(keccak256Text('a'.repeat(300))).toBe('0x5b7e0e47a96f32a88b4f14ca177982790807c40e1a105742ba0fc1babe1ef826');
  });
});

describe('the core entry', () => {
  it.each(CONSTANTS)('exports %s as a value', (name) => {
    const symbol = context.entry.get(name);

    expect(symbol, `${name} is not exported from src/index.ts`).toBeDefined();
    expect((symbol?.flags ?? 0) & ts.SymbolFlags.Variable).not.toBe(0);
  });
});

describe('VERDICT_MAGIC_VALUE', () => {
  const selector = selectorOf(VERIFY_SIGNATURE);

  it('is one 32-byte word of hex', () => {
    expect(VERDICT_MAGIC_VALUE).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('equals the selector of verify(bytes,bytes32,bytes) left-aligned in the word, the rest zero', () => {
    expect(VERDICT_MAGIC_VALUE.toLowerCase()).toBe(`${selector}${'0'.repeat(56)}`);
  });

  it('is not the selector right-aligned, the way a uint would sit', () => {
    expect(VERDICT_MAGIC_VALUE.toLowerCase()).not.toBe(`0x${'0'.repeat(56)}${selector.slice(2)}`);
  });
});

describe('POLICY_METHOD_VERIFY_ABI', () => {
  it('holds the one function, verify', () => {
    expect(POLICY_METHOD_VERIFY_ABI).toHaveLength(1);
    expect(POLICY_METHOD_VERIFY_ABI[0]).toMatchObject({ type: 'function', name: 'verify' });
  });

  it('takes (bytes config, bytes32 digest, bytes proof), in that order', () => {
    const inputs = POLICY_METHOD_VERIFY_ABI[0].inputs.map((input) => [input.type, input.name]);

    expect(inputs).toEqual([
      ['bytes', 'config'],
      ['bytes32', 'digest'],
      ['bytes', 'proof'],
    ]);
  });

  it('is a view returning one bytes4, the magic value', () => {
    const [entry] = POLICY_METHOD_VERIFY_ABI;

    expect(entry.stateMutability).toBe('view');
    expect(entry.outputs.map((output) => output.type)).toEqual(['bytes4']);
  });

  it("names the function whose selector is the magic value's first four bytes", () => {
    const [entry] = POLICY_METHOD_VERIFY_ABI;
    const signature = `${entry.name}(${entry.inputs.map((input) => input.type).join(',')})`;

    expect(signature).toBe(VERIFY_SIGNATURE);
    expect(VERDICT_MAGIC_VALUE.slice(0, 10).toLowerCase()).toBe(selectorOf(signature));
  });
});

describe('the two version constants', () => {
  it('DIGEST_VERSION is a non-empty string, the EIP-712 domain version a digest is built under', () => {
    expect(typeof DIGEST_VERSION).toBe('string');
    expect(DIGEST_VERSION.length).toBeGreaterThan(0);
  });

  it('BODY_ENCODER_KEY is a list of manager addresses the body encoder is keyed to', () => {
    expect(Array.isArray(BODY_ENCODER_KEY)).toBe(true);
    expect(BODY_ENCODER_KEY.filter((address) => !ADDRESS.test(address))).toEqual([]);
  });
});
