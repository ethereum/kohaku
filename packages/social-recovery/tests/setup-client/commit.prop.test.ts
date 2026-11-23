import fc from 'fast-check';
import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  KitRefusalError,
  POLICY_MANAGER_WRITES_ABI,
  SETUP_CLIENT_VALIDATION_REFUSED_MESSAGE,
  type Hex,
  type PreparedBatch,
  type PreparedCall,
  type SetupDraft,
} from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  ARMING_DATA,
  build,
  draftArbitrary,
  FC_PARAMS,
  noSetupState,
  referenceCommitment,
  standingState,
  TIMEOUT,
  withBackup,
} from './doubles';

/** A valid draft whose clause thresholds are redrawn from zero to one past each clause's credential count. */
const thresholdDraftArbitrary: fc.Arbitrary<SetupDraft> = draftArbitrary.chain((draft) =>
  fc
    .tuple(...draft.clauses.map((clause) => fc.integer({ min: 0, max: clause.credentials.length + 1 })))
    .map((thresholds) => ({ ...draft, clauses: draft.clauses.map((clause, index) => ({ ...clause, threshold: thresholds[index] ?? clause.threshold })) })),
);

describe('prepareCommitSetup properties', () => {
  it(
    'commits the independently recomputed commitment at the stored nonce plus one, armed exactly when unauthorized',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          draftArbitrary,
          fc.bigInt({ min: 0n, max: 2n ** 63n }),
          fc.boolean(),
          fc.boolean(),
          async (generated, stored, authorized, standing) => {
            const draft = withBackup(generated, 'empty');
            const state = standing ? standingState(`0x${'c7'.repeat(32)}`, stored, 10) : noSetupState(stored, 10);
            const { client } = build({ world: { state, authorized } });

            expect((await client.validateSetup(draft)).errors).toEqual([]);

            const prepared = await client.prepareCommitSetup(draft, undefined, { simulate: false });
            const commit: PreparedCall = authorized ? (prepared as PreparedCall) : ((prepared as PreparedBatch).calls[1] as PreparedCall);

            expect(prepared.kind).toBe(authorized ? 'call' : 'batch');

            if (!authorized) {
              expect((prepared as PreparedBatch).atomic).toBe(true);
              expect((prepared as PreparedBatch).calls[0]?.data).toBe(ARMING_DATA);
            }

            const decoded = decodeFunctionData({ abi: POLICY_MANAGER_WRITES_ABI, data: commit.data });

            expect(decoded.args?.[1]).toBe(referenceCommitment(draft, ACCOUNT, ACTION, stored + 1n) as Hex);
            expect(decoded.args?.[2]).toBe(stored + 1n);
          },
        ),
        FC_PARAMS,
      );
    },
    TIMEOUT,
  );

  it(
    'refuses exactly the drafts validateSetup reports an error for, over thresholds from zero to one past the count',
    async () => {
      await fc.assert(
        fc.asyncProperty(thresholdDraftArbitrary, async (generated) => {
          const draft = withBackup(generated, 'empty');
          const judged = await build().client.validateSetup(draft);
          const outcome = await build()
            .client.prepareCommitSetup(draft, undefined, { simulate: false })
            .then(
              () => 'prepared' as const,
              (error: unknown) => ({ exact: (error as object).constructor === KitRefusalError, message: (error as Error).message, findings: (error as KitRefusalError).findings }),
            );

          expect(outcome).toEqual(
            judged.errors.length === 0 ? 'prepared' : { exact: true, message: SETUP_CLIENT_VALIDATION_REFUSED_MESSAGE, findings: judged },
          );
        }),
        FC_PARAMS,
      );
    },
    TIMEOUT,
  );
});
