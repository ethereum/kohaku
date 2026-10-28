import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultSalt } from '../../src/index';
import { address, place, run, TIMEOUT } from '../formats/arbitraries';
import { oracleSaltHand, oracleSaltViem } from '../formats/request-support';

describe('defaultSalt', () => {
  it('equals keccak256(abi.encode(account, place)) by viem and by hand', () => {
    run(
      fc.property(address, place, (account, p) => {
        const salt = defaultSalt(account, p);

        expect(salt).toBe(oracleSaltViem(account, p));
        expect(salt).toBe(oracleSaltHand(account, p));
      }),
    );
  }, TIMEOUT);

  it('changes with either input', () => {
    run(
      fc.property(address, address, place, place, (a, b, p, q) => {
        fc.pre(a !== b && p !== q);

        expect(defaultSalt(a, p)).not.toBe(defaultSalt(b, p));
        expect(defaultSalt(a, p)).not.toBe(defaultSalt(a, q));
      }),
    );
  }, TIMEOUT);
});
