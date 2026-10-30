import { encodePacked, keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { defaultSalt, type Hex } from '../../src/index';
import { oracleSaltHand, oracleSaltViem } from '../formats/request-support';
import { A_ACCOUNT, AN_ACTION, ZERO_ADDRESS } from '../formats/support';

const CHECKSUMMED = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

describe('defaultSalt', () => {
  it('is keccak256 over the account word and the place word', () => {
    expect(defaultSalt(A_ACCOUNT, 3)).toBe(oracleSaltHand(A_ACCOUNT, 3));
    expect(defaultSalt(A_ACCOUNT, 3)).toBe(oracleSaltViem(A_ACCOUNT, 3));
  });

  it('holds at place 0, at the zero account and at both together', () => {
    expect(defaultSalt(A_ACCOUNT, 0)).toBe(oracleSaltHand(A_ACCOUNT, 0));
    expect(defaultSalt(ZERO_ADDRESS, 1)).toBe(oracleSaltHand(ZERO_ADDRESS, 1));
    expect(defaultSalt(ZERO_ADDRESS, 0)).toBe('0xad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb5');
  });

  it('holds at place MAX_SAFE_INTEGER and refuses a place beyond it', () => {
    expect(defaultSalt(A_ACCOUNT, Number.MAX_SAFE_INTEGER)).toBe(oracleSaltHand(A_ACCOUNT, Number.MAX_SAFE_INTEGER));
    expect(() => defaultSalt(A_ACCOUNT, Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it('is abi.encode, never encodePacked', () => {
    const packed = keccak256(encodePacked(['address', 'uint256'], [A_ACCOUNT, 3n]));

    expect(defaultSalt(A_ACCOUNT, 3)).not.toBe(packed);
  });

  it('is deterministic and changes with either input', () => {
    const base = defaultSalt(A_ACCOUNT, 3);

    expect(defaultSalt(A_ACCOUNT, 3)).toBe(base);
    expect(defaultSalt(A_ACCOUNT, 4)).not.toBe(base);
    expect(defaultSalt(AN_ACTION, 3)).not.toBe(base);
  });

  it('accepts every valid spelling of the account alike', () => {
    const expected = defaultSalt(CHECKSUMMED, 1);

    expect(defaultSalt(CHECKSUMMED.toLowerCase() as Hex, 1)).toBe(expected);
    expect(defaultSalt(`0x${CHECKSUMMED.slice(2).toUpperCase()}`, 1)).toBe(expected);
  });

  it.each([
    ['a wrong-checksum account', '0x8Ba1f109551bD432803012645Ac136ddd64DBA72', 1],
    ['a 19-byte account', '0x11111111111111111111111111111111111111', 1],
    ['a negative place', A_ACCOUNT, -1],
    ['a fractional place', A_ACCOUNT, 1.5],
    ['a bigint place', A_ACCOUNT, 1n],
    ['a string place', A_ACCOUNT, '1'],
  ])('refuses %s', (_label, account, place) => {
    expect(() => defaultSalt(account as Hex, place as number)).toThrow();
  });

  it('takes exactly two inputs, so no password or supplied salt can reach it', () => {
    expect(defaultSalt.length).toBe(2);
  });
});
