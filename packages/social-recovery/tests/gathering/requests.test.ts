import { describe, expect, it } from 'vitest';
import { requests, type ApproverRequest, type Gathering } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  approvalGathering,
  cancellationGathering,
  configAt,
  MANAGER,
  PAYEE,
  placeEntry,
  saltAt,
  TOKEN,
  VALID_UNTIL,
  METHOD,
} from './support';

const BODY_HASH = '0x6b359609fb43fd6343d702b855975035a90d454cb081cb662938e219a51a1160';

/** The request a place of the default gathering must yield, written out field by field. */
function expectedRequest(place: number, purpose: 'approval' | 'cancellation'): ApproverRequest {
  const common = {
    kind: 'recovery-proof-request' as const,
    version: 1,
    chainId: '1',
    manager: MANAGER,
    digestVersion: '1',
    account: ACCOUNT,
    action: ACTION,
    attemptId: '9',
    setupNonce: '7',
    setupBodyHash: BODY_HASH as `0x${string}`,
    validUntil: String(VALID_UNTIL),
    place,
    method: METHOD,
    config: configAt(place),
    salt: saltAt(place),
    credentialHoldsCode: place % 2 === 1,
  };

  return purpose === 'approval'
    ? { ...common, purpose, payload: '0xabcdef', order: { token: TOKEN, amount: '1234567890123456789', payee: PAYEE } }
    : { ...common, purpose };
}

/** Every config and salt of the gathering's places other than the given one. */
const othersOf = (record: Gathering, place: number) =>
  record.places.filter((p) => p.place !== place).flatMap((p) => [p.config.slice(2), p.salt.slice(2)]);

describe('requests', () => {
  it('yields one approval request per place, each written out in full', () => {
    expect(requests(approvalGathering())).toStrictEqual([0, 1, 2, 3].map((p) => expectedRequest(p, 'approval')));
  });

  it('yields one cancellation request per place, with no payload and no order', () => {
    const out = requests(cancellationGathering());

    expect(out).toStrictEqual([0, 1, 2, 3].map((p) => expectedRequest(p, 'cancellation')));

    for (const request of out) {
      expect(request).not.toHaveProperty('payload');
      expect(request).not.toHaveProperty('order');
    }
  });

  it('never carries the label, the body, the pinned block or consumableAfter', () => {
    for (const record of [approvalGathering(), cancellationGathering()]) {
      for (const request of requests(record)) {
        for (const key of ['label', 'setupBody', 'block', 'consumableAfter', 'places', 'replies', 'standing', 'stoppable']) {
          expect(request).not.toHaveProperty(key);
        }

        const text = JSON.stringify(request);

        expect(text).not.toContain('person ');
        expect(text).not.toContain('bb'.repeat(32));
        expect(text).not.toContain(record.request.setupBody.slice(2, 66 + 128));
      }
    }
  });

  it('never leaks another place\'s config or salt', () => {
    const record = approvalGathering();

    for (const request of requests(record)) {
      const text = JSON.stringify(request);

      for (const other of othersOf(record, request.place)) expect(text).not.toContain(other);
    }
  });

  it('carries credentialHoldsCode from the place, true and false alike', () => {
    const places = [placeEntry(0, { credentialHoldsCode: true }), placeEntry(1, { credentialHoldsCode: false })];
    const record = approvalGathering([...places, placeEntry(2), placeEntry(3)]);

    expect(requests(record).map((r) => r.credentialHoldsCode)).toStrictEqual([true, false, false, true]);
  });

  it('every request of one gathering carries the same window', () => {
    expect(new Set(requests(approvalGathering()).map((r) => r.validUntil))).toStrictEqual(new Set([String(VALID_UNTIL)]));
  });

  it('a gathering with no places yields no requests', () => {
    expect(requests(approvalGathering([]))).toStrictEqual([]);
  });
});
