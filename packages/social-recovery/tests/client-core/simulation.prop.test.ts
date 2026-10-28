import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { decodeRevert, simulatePrepared, type Address, type Hex, type PreparedBatch, type SimulationResult } from '../../src/index';
import { NO_SETUP_REVERT, preparedCall, UNKNOWN_REVERT } from './simulation-fixtures';
import { ACCOUNT, anyAddress, anyBytes, BLOCK, providerDouble, runAsync, TIMEOUT, ZERO_ADDRESS } from './support';

const TRANSPORT = new Error('transport failure');

type Outcome = { readonly kind: 'success' } | { readonly kind: 'revert'; readonly data: Hex } | { readonly kind: 'transport' };

const outcome: fc.Arbitrary<Outcome> = fc.oneof(
  fc.constant({ kind: 'success' } as const),
  fc.oneof(fc.constantFrom(NO_SETUP_REVERT, UNKNOWN_REVERT, '0x' as Hex), anyBytes(40)).map((data) => ({ kind: 'revert', data }) as const),
  fc.constant({ kind: 'transport' } as const),
);

const step = fc.record({ sender: fc.constantFrom('account', 'anyone' as const), data: anyBytes(8), outcome });

describe('simulatePrepared over arbitrary batches and outcome scripts', () => {
  it('matches the reference: in order, at one block, stopping at a transport failure', async () => {
    const options = fc.record({ simulate: fc.option(fc.boolean(), { nil: undefined }), from: fc.option(anyAddress.map((address) => getAddress(address)), { nil: undefined }) });

    await runAsync(fc.asyncProperty(fc.array(step, { maxLength: 5 }), options, fc.boolean(), async (steps, option, configured) => {
      const double = providerDouble(async (_, index) => {
        const scripted = steps[index]?.outcome;

        if (scripted?.kind === 'revert') throw { data: scripted.data };

        if (scripted?.kind === 'transport') throw TRANSPORT;

        return '0x';
      });
      const batch: PreparedBatch = {
        kind: 'batch',
        calls: steps.map((item) => preparedCall(item.sender, item.data)),
        atomic: true,
        block: BLOCK,
      };
      const prepareOptions = { ...(option.simulate === undefined ? {} : { simulate: option.simulate }), ...(option.from === undefined ? {} : { from: option.from }) };
      const runs = option.simulate ?? configured;
      const fromOf = (sender: string): Address => (sender === 'account' ? ACCOUNT : (option.from ?? ZERO_ADDRESS));
      const result = simulatePrepared(double.provider, batch, ACCOUNT, { simulate: configured }, prepareOptions);

      if (!runs) {
        expect(await result).toEqual(batch);
        expect(double.calls).toEqual([]);

        return;
      }

      const failing = steps.findIndex((item) => item.outcome.kind === 'transport');
      const reached = failing === -1 ? steps : steps.slice(0, failing + 1);

      expect(
        await result.then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        ),
      ).toEqual(
        failing === -1
          ? {
              value: {
                ...batch,
                calls: batch.calls.map((call, index) => {
                  const scripted = steps[index]?.outcome;
                  const simulation: SimulationResult =
                    scripted?.kind === 'revert' ? { success: false, from: fromOf(call.sender), error: decodeRevert(scripted.data) } : { success: true };

                  return { ...call, simulation };
                }),
              },
            }
          : { error: TRANSPORT },
      );
      expect(double.calls.map((seen) => [seen.data, seen.from.toLowerCase(), seen.block])).toEqual(
        reached.map((item) => [item.data, fromOf(item.sender).toLowerCase(), BLOCK.number]),
      );
    }));
  }, TIMEOUT);
});
