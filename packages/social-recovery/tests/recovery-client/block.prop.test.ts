import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chain, configuration, worldOf } from './arbitraries';
import { callsTo, HANDOVER, ORDER, rig, runAsync, TIMEOUT } from './doubles';

describe('the init over arbitrary configurations and readings', () => {
  it(
    'reads one block and names one block number everywhere',
    async () => {
      await runAsync(
        fc.asyncProperty(configuration, chain, fc.boolean(), async (config, facts, cancelling) => {
          const built = rig(worldOf(config, facts, cancelling));
          const window = Math.min(facts.window, 7_200);

          if (cancelling) await built.client.initCancelGathering(config, { window });
          else await built.client.initRecoveryGathering(config, HANDOVER, ORDER, { window });

          expect(callsTo(built.seen, 'provider', 'block')).toHaveLength(1);

          const numbers = new Set<number>();

          for (const one of built.seen) {
            if (one.part === 'provider' && one.member === 'code') numbers.add(one.args[1] as number);

            if (one.part === 'manager' || one.part === 'action') numbers.add((one.args[one.args.length - 1] as { number: number }).number);
          }

          expect([...numbers]).toEqual([facts.number]);
        }),
      );
    },
    TIMEOUT,
  );
});
