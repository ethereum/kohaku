import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  approvalDigest,
  approvalTypedData,
  cancellationDigest,
  cancellationTypedData,
  requests,
  type ApproverRequest,
} from '../../src/index';
import { run, TIMEOUT } from '../formats/arbitraries';
import { gatheringArb, METHODS } from './arbitraries';
import { ctxOf, orchestratorOver, recordingMethod } from './doubles';
import { APPROVAL_TYPES, CANCELLATION_TYPES, membersOf } from './expected';

/** The digest and typed data the merged builders give for one request's place. */
function builtBy(request: ApproverRequest) {
  const members = membersOf(request);

  if (request.purpose === 'approval' && 'payload' in members) {
    return { digest: approvalDigest(members, request.place), typedData: approvalTypedData(members, request.place) };
  }

  return { digest: cancellationDigest(members, request.place), typedData: cancellationTypedData(members, request.place) };
}

describe('the ctx of every request of a gathering against the digest builders', () => {
  it('carries the very digest and typed data the builders give, under the request\'s own non-empty digest version', () => {
    run(
      fc.property(gatheringArb, (record) => {
        const { method, calls } = recordingMethod();
        const orchestrator = orchestratorOver(METHODS.map((address) => [address, method] as const));

        for (const request of requests(record)) {
          calls.length = 0;
          orchestrator.signingInput(request);

          const ctx = ctxOf(calls, 'signingInput');
          const built = builtBy(request);

          expect(ctx.digest).toBe(built.digest);
          expect(ctx.typedData).toStrictEqual(built.typedData);
          expect(ctx.typedData.types).toStrictEqual(request.purpose === 'approval' ? APPROVAL_TYPES : CANCELLATION_TYPES);
          expect(ctx.request.digestVersion).toBe(BigInt(request.digestVersion).toString());
          expect(ctx.request.digestVersion).not.toBe('');
          expect(ctx.typedData.domain.version).toBe(ctx.request.digestVersion);
        }
      }),
    );
  }, TIMEOUT);
});
