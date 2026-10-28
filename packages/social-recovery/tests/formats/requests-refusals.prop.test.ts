import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeAttemptRequest, decodeCancelRequest, encodeAttemptRequest, encodeCancelRequest } from '../../src/index';
import { run, TIMEOUT } from './arbitraries';
import { attemptRequest, foreignSelector, trailing } from './request-arbitraries';
import { rawAttempt, rawCancel } from './request-support';

describe('request codec refusals', () => {
  it('a repeated place is refused by the encoders', () => {
    run(
      fc.property(attemptRequest(1), fc.nat(), (request, pick) => {
        const twin = request.proofs[pick % request.proofs.length]!;
        const proofs = [...request.proofs, { ...twin, proof: '0x01' as const }];

        expect(() => encodeAttemptRequest({ ...request, proofs })).toThrow();
        expect(() => encodeCancelRequest({ ...request, proofs })).toThrow();
      }),
    );
  }, TIMEOUT);

  it('decode refuses a wrong selector and trailing bytes', () => {
    run(
      fc.property(attemptRequest(), foreignSelector, trailing, (request, selector, extra) => {
        const attempt = encodeAttemptRequest(request);
        const cancel = encodeCancelRequest(request);

        expect(() => decodeAttemptRequest(`${selector}${attempt.slice(10)}`)).toThrow();
        expect(() => decodeCancelRequest(`${selector}${cancel.slice(10)}`)).toThrow();
        expect(() => decodeAttemptRequest(`${attempt}${extra}`)).toThrow();
        expect(() => decodeCancelRequest(`${cancel}${extra}`)).toThrow();
      }),
    );
  }, TIMEOUT);

  it('decode refuses proofs that are not strictly increasing by place', () => {
    run(
      fc.property(attemptRequest(2), fc.boolean(), (request, repeat) => {
        const sorted = [...request.proofs].sort((a, b) => a.place - b.place);
        const proofs = repeat ? [...sorted, { ...sorted[sorted.length - 1]!, proof: '0x' as const }] : [...sorted].reverse();

        expect(() => decodeAttemptRequest(rawAttempt({ ...request, proofs }))).toThrow();
        expect(() => decodeCancelRequest(rawCancel({ ...request, proofs }))).toThrow();
      }),
    );
  }, TIMEOUT);
});
