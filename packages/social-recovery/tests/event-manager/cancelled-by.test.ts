import { describe, expect, it } from 'vitest';
import type { Address, KitNotification } from '../../src/index';
import { ACCOUNT, ACTION, eventLog, makeReader, MANAGER, METHOD_AADHAAR, STRANGER, ZERO } from './fixture';

type Fields = { canceller: Address; vetoingMethod: Address; usedPlaces: bigint[] };

const reader = makeReader();

const cancelled = (fields: Fields, account: Address = ACCOUNT): KitNotification | undefined =>
  reader.decodeLog(eventLog(MANAGER, 'AttemptCancelled', { account, action: ACTION, attemptId: 3n, setupNonce: 2n, ...fields }));

const cancelledBy = (fields: Fields, account?: Address): string | undefined => {
  const notification = cancelled(fields, account);

  return notification?.kind === 'attempt-cancelled' ? notification.cancelledBy : undefined;
};

describe('cancelledBy: the four outcomes', () => {
  it('cancelByVeto: a nonzero vetoingMethod, empty places, a stranger as canceller', () => {
    expect(cancelledBy({ canceller: STRANGER, vetoingMethod: METHOD_AADHAAR, usedPlaces: [] })).toBe('cancelByVeto');
  });

  it('cancelByVeto settles alone, whatever the canceller and places say', () => {
    expect(cancelledBy({ canceller: ACCOUNT, vetoingMethod: METHOD_AADHAAR, usedPlaces: [] })).toBe('cancelByVeto');
    expect(cancelledBy({ canceller: ZERO, vetoingMethod: METHOD_AADHAAR, usedPlaces: [] })).toBe('cancelByVeto');
    expect(cancelledBy({ canceller: STRANGER, vetoingMethod: METHOD_AADHAAR, usedPlaces: [1n] })).toBe('cancelByVeto');
  });

  it('cancelByProofs: no veto and non-empty places, submitted by a stranger', () => {
    expect(cancelledBy({ canceller: STRANGER, vetoingMethod: ZERO, usedPlaces: [0n, 2n] })).toBe('cancelByProofs');
  });

  it('cancelByProofs even when the holder submitted the proof set from the account', () => {
    expect(cancelledBy({ canceller: ACCOUNT, vetoingMethod: ZERO, usedPlaces: [5n] })).toBe('cancelByProofs');
  });

  it("cancelByOwner: no veto, empty places, the log's account as canceller", () => {
    expect(cancelledBy({ canceller: ACCOUNT, vetoingMethod: ZERO, usedPlaces: [] })).toBe('cancelByOwner');
  });

  it("cancelByOwner compares the canceller with the log's own account", () => {
    expect(cancelledBy({ canceller: STRANGER, vetoingMethod: ZERO, usedPlaces: [] }, STRANGER)).toBe('cancelByOwner');
  });

  it('setupWrite: no veto, empty places, a zero canceller', () => {
    expect(cancelledBy({ canceller: ZERO, vetoingMethod: ZERO, usedPlaces: [] })).toBe('setupWrite');
  });

  it('the raw fields travel beside the derived one', () => {
    expect(cancelled({ canceller: ZERO, vetoingMethod: ZERO, usedPlaces: [] })).toMatchObject({
      kind: 'attempt-cancelled',
      attemptId: 3n,
      setupNonce: 2n,
      usedPlaces: [],
    });
  });
});

describe('cancelledBy: the impossible combination (throws)', () => {
  it('no veto, empty places, a stranger as canceller throws', () => {
    // No manager path emits this combination, so it has no defined outcome; the test pins the current throw.
    expect(() => cancelled({ canceller: STRANGER, vetoingMethod: ZERO, usedPlaces: [] })).toThrow();
  });
});
