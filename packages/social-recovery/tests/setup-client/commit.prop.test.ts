import fc from 'fast-check';
import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';
import { POLICY_MANAGER_WRITES_ABI, type Hex, type PreparedBatch, type PreparedCall } from '../../src/index';
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
});
