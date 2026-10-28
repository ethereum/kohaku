import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeAttemptRequest, decodeCancelRequest, encodeAttemptRequest, encodeCancelRequest } from '../../src/index';
import { run, TIMEOUT } from './arbitraries';
import { attemptRequest, cancelRequest } from './request-arbitraries';
import { decodedAttempt, decodedCancel } from './request-rows';
import { oracleAttempt, oracleCancel } from './request-support';

describe('request codecs', () => {
  it('encodeAttemptRequest equals the reference and round-trips both ways', () => {
    run(
      fc.property(attemptRequest(), (request) => {
        const calldata = encodeAttemptRequest(request);

        expect(calldata).toBe(oracleAttempt(request));
        expect(decodeAttemptRequest(calldata)).toStrictEqual(decodedAttempt(request));
        expect(encodeAttemptRequest(decodeAttemptRequest(calldata))).toBe(calldata);
      }),
    );
  }, TIMEOUT);

  it('encodeCancelRequest equals the reference and round-trips both ways', () => {
    run(
      fc.property(cancelRequest(), (request) => {
        const calldata = encodeCancelRequest(request);

        expect(calldata).toBe(oracleCancel(request));
        expect(decodeCancelRequest(calldata)).toStrictEqual(decodedCancel(request));
        expect(encodeCancelRequest(decodeCancelRequest(calldata))).toBe(calldata);
      }),
    );
  }, TIMEOUT);

  it('encoding is independent of the order the proofs come in, and the input order is kept', () => {
    run(
      fc.property(attemptRequest(), fc.integer(), (request, shift) => {
        const before = [...request.proofs];
        const n = request.proofs.length;
        const rotated = request.proofs.map((_p, i) => request.proofs[(i + Math.abs(shift)) % n]!);
        const reversed = [...request.proofs].reverse();
        const expected = encodeAttemptRequest(request);

        expect(encodeAttemptRequest({ ...request, proofs: rotated })).toBe(expected);
        expect(encodeAttemptRequest({ ...request, proofs: reversed })).toBe(expected);
        expect(encodeCancelRequest({ ...request, proofs: reversed })).toBe(encodeCancelRequest({ ...request }));
        expect(request.proofs).toStrictEqual(before);
      }),
    );
  }, TIMEOUT);
});
