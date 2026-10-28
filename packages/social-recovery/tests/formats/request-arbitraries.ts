import fc from 'fast-check';
import type { AttemptRequest, CancelRequest, PaymentOrder, ProofPlace } from '../../src/index';
import { address, anyBytes, bytesN, place, uint, uint48 } from './arbitraries';

export const proofPlace: fc.Arbitrary<ProofPlace> = fc.record({
  place,
  method: address,
  config: anyBytes,
  salt: bytesN(32),
  proof: anyBytes,
});

/** Proofs with distinct places, in arbitrary order. */
export const proofs = (minLength = 0): fc.Arbitrary<ProofPlace[]> =>
  fc.uniqueArray(proofPlace, { minLength, maxLength: 5, selector: (p) => p.place });

export const order: fc.Arbitrary<PaymentOrder> = fc.record({ token: address, amount: uint(256), payee: address });

export const attemptRequest = (minProofs = 0): fc.Arbitrary<AttemptRequest> =>
  fc.record({
    account: address,
    action: address,
    attemptId: uint(64),
    setupNonce: uint(64),
    setupBody: anyBytes,
    payload: anyBytes,
    order,
    validUntil: uint48,
    proofs: proofs(minProofs),
  });

export const cancelRequest = (minProofs = 0): fc.Arbitrary<CancelRequest> =>
  fc.record({
    account: address,
    action: address,
    attemptId: uint(64),
    setupNonce: uint(64),
    setupBody: anyBytes,
    validUntil: uint48,
    proofs: proofs(minProofs),
  });

/** A four-byte selector other than the two request selectors. */
export const foreignSelector = bytesN(4).filter((s) => s !== '0x70faa9d0' && s !== '0xecafb29f');

/** One to thirty-two trailing bytes. */
export const trailing = fc.uint8Array({ minLength: 1, maxLength: 32 }).map((b) => Buffer.from(b).toString('hex'));
