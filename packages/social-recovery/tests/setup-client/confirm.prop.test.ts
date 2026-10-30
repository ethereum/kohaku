import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Hex, KitNotification, PreparedCall } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  build,
  COMMITTED,
  committed,
  cleared,
  DRAFT,
  FC_PARAMS,
  position,
  referenceCommitment,
  standingState,
  TIMEOUT,
  withBackup,
} from './doubles';

const DRAFT_EMPTY = withBackup(DRAFT, 'empty');
const NONCE = 5n;
const COMMITMENT = referenceCommitment(DRAFT_EMPTY, ACCOUNT, ACTION, NONCE);
const OTHER: Hex = `0x${'ab'.repeat(32)}`;

const eventArbitrary = fc.record({
  kind: fc.constantFrom('setup-committed', 'setup-cleared'),
  nonce: fc.bigInt({ min: 3n, max: 7n }),
  matches: fc.boolean(),
});

describe('confirmSetup properties', () => {
  it(
    'answers landed exactly when an event at the predicted nonce carries the commitment',
    async () => {
      const prepared = (await build({ world: { authorized: true, state: standingState(COMMITTED, NONCE - 1n, 10) } }).client.prepareCommitSetup(
        DRAFT_EMPTY,
        undefined,
        { simulate: false },
      )) as PreparedCall;

      await fc.assert(
        fc.asyncProperty(fc.array(eventArbitrary, { maxLength: 6 }), async (drafts) => {
          const bound: KitNotification[] = drafts.map((item, index) =>
            item.kind === 'setup-committed'
              ? committed(item.nonce, item.matches ? COMMITMENT : OTHER, '0x', position(5_001 + index, index))
              : cleared(item.nonce, position(5_001 + index, index)),
          );
          const { client } = build({ world: { bound } });
          const confirmation = await client.confirmSetup(DRAFT_EMPTY, prepared);
          const atNonce = drafts.filter((item) => item.kind === 'setup-committed' && item.nonce === NONCE);
          const landed = atNonce.some((item) => item.matches);

          expect(confirmation.landed).toBe(landed);
          expect(confirmation.nonce).toBe(NONCE);
          expect(confirmation.setupCommitment).toBe(COMMITMENT);

          if (landed) expect(confirmation.cause).toBeUndefined();
          else expect(confirmation.cause).toBe(atNonce.length === 0 ? 'no-event' : 'other-commitment');

          expect(confirmation.position === undefined).toBe(atNonce.length === 0);
        }),
        FC_PARAMS,
      );
    },
    TIMEOUT,
  );
});
