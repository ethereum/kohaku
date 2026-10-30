import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { digestFor } from '../../src/gathering/edge';
import { requests } from '../../src/index';
import { run, TIMEOUT } from '../formats/arbitraries';
import { gatheringArb, METHODS } from './arbitraries';
import { ctxOf, orchestratorOver, recordingMethod } from './doubles';
import { expectedDigest, hashOf } from './expected';

describe('the ctx digest of every request of a gathering', () => {
  it('equals the digest the gathering files for that place, and its typed data hashes to it', () => {
    run(
      fc.property(gatheringArb, (record) => {
        const { method, calls } = recordingMethod();
        const orchestrator = orchestratorOver(METHODS.map((address) => [address, method] as const));

        for (const request of requests(record)) {
          calls.length = 0;
          orchestrator.signingInput(request);

          const ctx = ctxOf(calls, 'signingInput');

          expect(ctx.place).toBe(request.place);
          expect(ctx.digest).toBe(digestFor(record, request.place));
          expect(ctx.digest).toBe(expectedDigest(request));
          expect(hashOf(ctx.typedData)).toBe(ctx.digest);
        }
      }),
    );
  }, TIMEOUT);
});
