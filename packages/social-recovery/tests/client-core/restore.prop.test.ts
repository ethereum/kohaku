import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { KitRefusalError, restoreConfiguration, type Configuration, type Hex, type KitNotification, type RestoreCause } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  actionState,
  anyAddress,
  anyBytes,
  BLOCK,
  bytesN,
  cleared,
  committed,
  eventsDouble,
  position,
  referenceConfigurationCommitment,
  runAsync,
  TIMEOUT,
} from './support';

const NONCE = 10n;
const COMMITMENT: Hex = `0x${'c0'.repeat(32)}`;
const OTHER_COMMITMENT: Hex = `0x${'0c'.repeat(32)}`;
const PASSWORD = { password: 'correct horse battery staple' };

/** One notification draft: kind, nonce, commitment, payload and removed flag, placed later by its index. */
const draft = fc.record({
  kind: fc.constantFrom('setup-committed', 'setup-cleared', 'attempt-consumed' as const),
  nonce: fc.bigInt({ min: 7n, max: 13n }),
  commitment: fc.constantFrom(COMMITMENT, OTHER_COMMITMENT, COMMITMENT.toUpperCase().replace('0X', '0x') as Hex),
  payload: fc.oneof(fc.constant('0x' as Hex), bytesN(2), anyBytes(40)),
  removed: fc.boolean(),
});

/** Drafts whose live setup-committed nonces are distinct, as the manager bumps the nonce on every write. */
const drafts = fc.array(draft, { maxLength: 8 }).filter((list) => {
  const live = list.filter((item) => item.kind === 'setup-committed' && !item.removed).map((item) => item.nonce);

  return new Set(live).size === live.length;
});

type Draft = { readonly kind: string; readonly nonce: bigint; readonly commitment: Hex; readonly payload: Hex; readonly removed: boolean };

const toNotification = (item: Draft, index: number): KitNotification => {
  const at = position(100 + index, index % 3, item.removed);

  if (item.kind === 'setup-committed') return committed(item.nonce, item.commitment, item.payload, at);

  if (item.kind === 'setup-cleared') return cleared(item.nonce, at);

  return { kind: 'attempt-consumed', account: ACCOUNT, action: ACTION, attemptId: item.nonce, at };
};

/** The selection rule written independently: drop removed, keep commits, take the highest nonce, confirm it, open it. */
function expectedCause(list: readonly Draft[]): RestoreCause {
  const live = list.filter((item) => item.kind === 'setup-committed' && !item.removed);
  const highest = live.reduce<Draft | undefined>((best, item) => (best === undefined || item.nonce > best.nonce ? item : best), undefined);
  const confirmed =
    highest !== undefined && highest.nonce === NONCE && highest.commitment.toLowerCase() === COMMITMENT && highest.payload !== '0x';

  if (!confirmed) {
    return { code: 'restore.no-backup', subject: 'restore', values: { account: ACCOUNT, action: ACTION, case: 'no-backup-kept', nonce: NONCE } };
  }

  return {
    code: 'restore.backup-unopened',
    subject: 'restore',
    values: {
      payloadSize: (highest.payload.length - 2) / 2,
      authenticated: { account: ACCOUNT, action: ACTION, setupCommitment: COMMITMENT, nonce: NONCE, payloadVersion: 1 },
    },
  };
}

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('the restore over arbitrary notification lists', () => {
  it('selects the event the independent rule selects, in any order', async () => {
    await runAsync(fc.asyncProperty(drafts, async (list) => {
      const double = eventsDouble(list.map(toNotification));
      const thrown = await thrownBy(restoreConfiguration(double.events, ACCOUNT, ACTION, PASSWORD, actionState(COMMITMENT, NONCE), BLOCK));

      expect(thrown).toBeInstanceOf(KitRefusalError);
      expect((thrown as KitRefusalError).restoreCause).toStrictEqual(expectedCause(list));
      expect(double.fetches).toHaveLength(1);
    }));
  }, TIMEOUT);
});

const configuration: fc.Arbitrary<Configuration> = fc.record({
  clauses: fc.array(
    fc.record({
      threshold: fc.integer({ min: 0, max: 255 }),
      credentials: fc.array(fc.record({ method: anyAddress, config: anyBytes(32), salt: bytesN(32) }, { requiredKeys: ['method', 'config'] }), {
        maxLength: 3,
      }),
    }),
    { maxLength: 3 },
  ),
  wait: fc.integer({ min: 0, max: 2 ** 48 - 1 }),
  ignoresPause: fc.boolean(),
});

describe('the commitment check over arbitrary configurations', () => {
  it('refuses commitment-mismatch exactly when the recomputation differs from the stored commitment', async () => {
    const stored = fc.oneof(bytesN(32).filter((word) => /[1-9a-f]/.test(word.slice(2))), fc.constant(undefined));

    await runAsync(fc.asyncProperty(configuration, stored, fc.bigInt({ min: 0n, max: 1000n }), async (config, other, nonce) => {
      const recomputed = referenceConfigurationCommitment(config, ACCOUNT, ACTION, nonce);
      const committedWord = other ?? recomputed;
      const double = eventsDouble([]);
      const result = restoreConfiguration(double.events, ACCOUNT, ACTION, config, actionState(committedWord, nonce), BLOCK);

      if (committedWord === recomputed) {
        await expect(result).resolves.toEqual(config);
      } else {
        const thrown = await thrownBy(result);

        expect((thrown as KitRefusalError).restoreCause).toStrictEqual({
          code: 'restore.commitment-mismatch',
          subject: 'restore',
          values: { recomputed, committed: committedWord },
        });
      }

      expect(double.fetches).toEqual([]);
    }));
  }, TIMEOUT);
});
