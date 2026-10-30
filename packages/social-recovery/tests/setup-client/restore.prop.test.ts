import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PreparedBatch } from '../../src/index';
import { build, committed, configurationOf, draftArbitrary, FC_PARAMS, position, standingState } from './doubles';

/** Every run derives the password key twice at the shipped iteration count, so this property runs a sixteenth of the standard count. */
const RUNS = Math.max(1, Math.ceil(FC_PARAMS.numRuns / 16));

describe('seal then restore', () => {
  it(
    'restores, from the backup a commit sealed, the configuration the draft closes over',
    async () => {
      await fc.assert(
        fc.asyncProperty(draftArbitrary, fc.string({ minLength: 1, maxLength: 24 }), async (draft, password) => {
          const { client, seen } = build();
          const prepared = (await client.prepareCommitSetup(draft, password, { simulate: false })) as PreparedBatch;
          const args = seen.parts.find((part) => part.member === 'prepareCommitSetup')?.args ?? [];
          const commitment = args[1] as `0x${string}`;
          const sealed = args[4] as `0x${string}`;
          const restoring = build({
            world: { state: standingState(commitment, 1n, 4_000), bound: [committed(1n, commitment, sealed, position(4_000))] },
          });

          expect(prepared.kind).toBe('batch');
          expect(await restoring.client.getSetup({ password })).toEqual(configurationOf(draft));
        }),
        { numRuns: RUNS },
      );
    },
    RUNS * 4_000 + 10_000,
  );
});
