import fc from 'fast-check';
import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Address } from '../../src/index';
import { address, attempt, handover, header, waitingOver } from './prepare-arbitraries';
import { ACCOUNT, ACTION, MANAGER, rejectionOf, rig, runAsync, stateFor, TIMEOUT, world } from './doubles';
import { describedBatch, executeHandoverData, loweredCall, payloadOf, PIN_WRITES_ABI } from './encodings';

describe('prepareExecuteHandover over arbitrary orders, handovers and callers', () => {
  it('describes the action batch: consume, grant, revoke, and the payment only for a nonzero amount', async () => {
    await runAsync(
      fc.asyncProperty(
        handover,
        attempt,
        fc.option(address, { nil: undefined }),
        header,
        async (keys, base, from, pinned) => {
          const payload = payloadOf(keys.newAuthority, keys.removedAuthority);
          const stored = waitingOver(payload, { ...base, ignoresPause: true });
          const built = rig(world({ header: pinned, state: stateFor(undefined, stored) }));
          const run = built.client.prepareExecuteHandover(stored, payload, from === undefined ? undefined : { from });
          const open = BigInt(stored.order.payee) === 0n && stored.order.amount !== 0n;

          if (open && from === undefined) {
            expect(await rejectionOf(run)).toBeInstanceOf(TypeError);
            expect(built.seen).toEqual([]);

            return;
          }

          const prepared = await run;
          const expected = describedBatch(MANAGER, ACCOUNT, ACTION, stored.attemptId, payload, keys, stored.order, from).map(loweredCall);

          expect(prepared.data.toLowerCase()).toBe(executeHandoverData(ACCOUNT, payload).toLowerCase());
          expect(prepared.target.toLowerCase()).toBe(ACTION.toLowerCase());
          expect(prepared.describes?.map(loweredCall)).toEqual(expected);
          expect(prepared.describes).toHaveLength(stored.order.amount === 0n ? 3 : 4);

          const [grant, revoke] = [prepared.describes?.[1], prepared.describes?.[2]];
          const granted = decodeFunctionData({ abi: PIN_WRITES_ABI, data: grant?.data ?? '0x' }).args?.[0] as Address;
          const revoked = decodeFunctionData({ abi: PIN_WRITES_ABI, data: revoke?.data ?? '0x' }).args?.[0] as Address;

          expect(granted.toLowerCase()).toBe(keys.newAuthority.toLowerCase());
          expect(revoked.toLowerCase()).toBe(keys.removedAuthority.toLowerCase());
          expect(built.seen.filter((one) => one.part === 'provider' && one.member === 'block')).toHaveLength(1);
        },
      ),
    );
  }, TIMEOUT);
});
