import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { credentialHash, setupBodyHash, setupCommitment } from '../../src/index';
import {
  A_ACCOUNT,
  A_METHOD,
  AN_ACTION,
  addressWord,
  bytesTail,
  join,
  keccakLocal,
  repeat,
  UINT64_MAX,
  word,
  ZERO_ADDRESS,
  type Hex,
} from './support';

const SALT_AA = repeat('aa', 32);
const ZERO32 = repeat('00', 32);

/** The credential commitment's abi.encode preimage, built word by word. */
const credentialPreimage = (method: string, config: Hex, salt: Hex): Hex =>
  join(addressWord(method), word(0x60), salt.slice(2), bytesTail(config));

/** The setup commitment's abi.encode preimage, built word by word. */
const commitmentPreimage = (account: string, action: string, nonce: bigint, body: Hex): Hex =>
  join(addressWord(account), addressWord(action), word(nonce), word(0x80), bytesTail(body));

describe('credentialHash (the credential commitment)', () => {
  it('matches the hand-built abi.encode preimage for a two-byte config', () => {
    const expected = keccakLocal(credentialPreimage(A_METHOD, '0x1234', SALT_AA));

    expect(expected).toBe('0x61844a877e8810bb63886d28bcf7df8000aeaf55f16a7b7212c522c16bd7e0fd');
    expect(credentialHash(A_METHOD, '0x1234', SALT_AA)).toBe(expected);
  });

  it('matches the hand-built preimage for the zero method, empty config and zero salt', () => {
    const expected = keccakLocal(credentialPreimage(ZERO_ADDRESS, '0x', ZERO32));

    expect(expected).toBe('0x95ed33cacfb4bd126a51fa675a03b306beb369f81d951b7a40616cc1ac09e2cf');
    expect(credentialHash(ZERO_ADDRESS, '0x', ZERO32)).toBe(expected);
  });

  it.each([31, 32, 33, 64, 65])('pads a %i-byte config to whole words after its length', (length) => {
    const config = repeat('5a', length);

    expect(credentialHash(A_METHOD, config, SALT_AA)).toBe(keccakLocal(credentialPreimage(A_METHOD, config, SALT_AA)));
  });

  it('is abi.encode, never encodePacked', () => {
    const packed = keccakLocal(join(A_METHOD.slice(2), '1234', SALT_AA.slice(2)));

    expect(credentialHash(A_METHOD, '0x1234', SALT_AA)).not.toBe(packed);
  });

  it('treats a checksummed and a lowercase address as the same method', () => {
    const method = '0x8ba1f109551bd432803012645ac136ddd64dba72';

    expect(credentialHash(getAddress(method), '0x01', SALT_AA)).toBe(credentialHash(method, '0x01', SALT_AA));
  });

  it('changes with each of its three inputs', () => {
    const base = credentialHash(A_METHOD, '0x1234', SALT_AA);

    expect(credentialHash(AN_ACTION, '0x1234', SALT_AA)).not.toBe(base);
    expect(credentialHash(A_METHOD, '0x123400', SALT_AA)).not.toBe(base);
    expect(credentialHash(A_METHOD, '0x1234', repeat('ab', 32))).not.toBe(base);
  });

  it.each([
    ['odd-length config', A_METHOD, '0x123', SALT_AA],
    ['non-hex config', A_METHOD, '0xzz', SALT_AA],
    ['unprefixed config', A_METHOD, '1234', SALT_AA],
    ['31-byte salt', A_METHOD, '0x1234', repeat('aa', 31)],
    ['33-byte salt', A_METHOD, '0x1234', repeat('aa', 33)],
    ['odd-length salt', A_METHOD, '0x1234', `${SALT_AA}a`],
    ['19-byte method', '0x33333333333333333333333333333333333333', '0x1234', SALT_AA],
    ['21-byte method', `${A_METHOD}33`, '0x1234', SALT_AA],
    ['bad-checksum method', '0x8Ba1f109551bD432803012645Ac136ddd64DBA72', '0x1234', SALT_AA],
  ])('refuses a %s', (_label, method, config, salt) => {
    expect(() => credentialHash(method as Hex, config as Hex, salt as Hex)).toThrow();
  });
});

describe('setupBodyHash', () => {
  it('is keccak256 over the body bytes alone', () => {
    expect(setupBodyHash('0x')).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(setupBodyHash('0xabcdef')).toBe(keccakLocal('0xabcdef'));
  });

  it('refuses odd-length hex', () => {
    expect(() => setupBodyHash('0xabc')).toThrow();
  });
});

describe('setupCommitment', () => {
  it('matches the hand-built preimage over zero-length bytes', () => {
    const expected = keccakLocal(commitmentPreimage(A_ACCOUNT, AN_ACTION, 1n, '0x'));

    expect(expected).toBe('0x00ee68a10c1e00d746895cf7a5428b523089aa31117e25ec119a16aab7519c27');
    expect(setupCommitment(A_ACCOUNT, AN_ACTION, 1n, '0x')).toBe(expected);
  });

  it('commits an empty-clauses body cleanly and distinctly from zero-length bytes', () => {
    const emptyClauses = join(word(0), word(0), word(0x60), word(0));
    const expected = keccakLocal(commitmentPreimage(A_ACCOUNT, AN_ACTION, 1n, emptyClauses));

    expect(setupCommitment(A_ACCOUNT, AN_ACTION, 1n, emptyClauses)).toBe(expected);
    expect(expected).not.toBe(setupCommitment(A_ACCOUNT, AN_ACTION, 1n, '0x'));
  });

  it.each([0n, 1n, 7n, UINT64_MAX])('encodes nonce %s as a full uint64 word', (nonce) => {
    const body = repeat('01', 37);

    expect(setupCommitment(A_ACCOUNT, AN_ACTION, nonce, body)).toBe(
      keccakLocal(commitmentPreimage(A_ACCOUNT, AN_ACTION, nonce, body)),
    );
  });

  it('is abi.encode, never encodePacked', () => {
    const packed = keccakLocal(join(A_ACCOUNT.slice(2), AN_ACTION.slice(2), '0000000000000001'));

    expect(setupCommitment(A_ACCOUNT, AN_ACTION, 1n, '0x')).not.toBe(packed);
  });

  it('binds the action: one body under two actions commits differently', () => {
    const body = join(word(0), word(0), word(0x60), word(0));

    expect(setupCommitment(A_ACCOUNT, AN_ACTION, 1n, body)).not.toBe(setupCommitment(A_ACCOUNT, A_METHOD, 1n, body));
  });

  it('changes with the account, the nonce and the body', () => {
    const base = setupCommitment(A_ACCOUNT, AN_ACTION, 1n, '0x00');

    expect(setupCommitment(A_METHOD, AN_ACTION, 1n, '0x00')).not.toBe(base);
    expect(setupCommitment(A_ACCOUNT, AN_ACTION, 2n, '0x00')).not.toBe(base);
    expect(setupCommitment(A_ACCOUNT, AN_ACTION, 1n, '0x0000')).not.toBe(base);
  });

  it.each([
    ['a nonce of 2^64', UINT64_MAX + 1n, RangeError],
    ['a negative nonce', -1n, RangeError],
  ])('refuses %s with a RangeError', (_label, nonce, error) => {
    expect(() => setupCommitment(A_ACCOUNT, AN_ACTION, nonce, '0x')).toThrow(error);
  });

  it('refuses a number nonce, since uint64 travels as a bigint', () => {
    expect(() => setupCommitment(A_ACCOUNT, AN_ACTION, 1 as unknown as bigint, '0x')).toThrow(TypeError);
  });

  it.each([
    ['an odd-length body', A_ACCOUNT, AN_ACTION, '0x0'],
    ['a non-hex body', A_ACCOUNT, AN_ACTION, '0xgg'],
    ['a short account', '0x1111', AN_ACTION, '0x'],
    ['a short action', A_ACCOUNT, '0x2222', '0x'],
  ])('refuses %s', (_label, account, action, body) => {
    expect(() => setupCommitment(account as Hex, action as Hex, 1n, body as Hex)).toThrow();
  });
});
