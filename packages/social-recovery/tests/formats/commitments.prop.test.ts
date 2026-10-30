import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { credentialHash, setupCommitment } from '../../src/index';
import { address, anyBytes, bytesN, run, TIMEOUT, uint } from './arbitraries';
import { oracleCommitment, oracleCredential } from './support';

describe('commitments', () => {
  it('credentialHash equals the reference abi.encode preimage hash and is deterministic', () => {
    run(
      fc.property(address, anyBytes, bytesN(32), (method, config, salt) => {
        const expected = oracleCredential(method, config, salt);

        expect(credentialHash(method, config, salt)).toBe(expected);
        expect(credentialHash(getAddress(method), config, salt)).toBe(expected);
      }),
    );
  }, TIMEOUT);

  it('setupCommitment equals the reference and refuses a nonce outside uint64', () => {
    run(
      fc.property(address, address, uint(64), anyBytes, fc.bigInt({ min: 1n << 64n, max: 1n << 80n }), (account, action, nonce, b, big) => {
        expect(setupCommitment(account, action, nonce, b)).toBe(oracleCommitment(account, action, nonce, b));
        expect(() => setupCommitment(account, action, big, b)).toThrow(RangeError);
        expect(() => setupCommitment(account, action, -nonce - 1n, b)).toThrow(RangeError);
      }),
    );
  }, TIMEOUT);
});
