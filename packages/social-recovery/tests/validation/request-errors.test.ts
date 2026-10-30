import { describe, expect, it } from 'vitest';
import { validateRequest, type AttemptRequest, type CancelRequest, type Hex, type RequestValidationContext } from '../../src/index';
import { oracleBody, oracleCommitment } from '../formats/support';
import {
  ACCOUNT,
  ACTION,
  BODY,
  CANCEL,
  CANCEL_CONTEXT,
  NEW_KEY,
  OLD_KEY,
  OPENING,
  PASSKEY,
  REQUEST_CONTEXT,
  STATE,
  T,
  WAITING_STATE,
  ZERO,
  config,
  findingsOf,
} from './fixtures';

type Request = AttemptRequest | CancelRequest;

const errorCodes = (request: Request = OPENING, context: RequestValidationContext = REQUEST_CONTEXT): string[] =>
  validateRequest(request, context).errors.map((finding) => finding.code);

/** An opening request and its context over another body, the stored commitment matching it. */
function overBody(body: typeof BODY, proofs = OPENING.proofs): [AttemptRequest, RequestValidationContext] {
  const setupBody = oracleBody(body);

  return [
    { ...OPENING, setupBody, proofs },
    { ...REQUEST_CONTEXT, state: { ...STATE, setupCommitment: oracleCommitment(ACCOUNT, ACTION, 3n, setupBody) } },
  ];
}

const withHandover = (extra: Partial<NonNullable<RequestValidationContext['handover']>>): RequestValidationContext => ({
  ...REQUEST_CONTEXT,
  handover: { ...REQUEST_CONTEXT.handover!, ...extra },
});

describe('validateRequest errors', () => {
  it('raises no error on the healthy opening and the healthy cancellation', () => {
    expect(errorCodes()).toEqual([]);
    expect(errorCodes(CANCEL, CANCEL_CONTEXT)).toEqual([]);
  });

  it('raises request.attempt-id against the next id on an opening and the live id on a cancellation', () => {
    expect(validateRequest({ ...OPENING, attemptId: 8n }, REQUEST_CONTEXT).errors).toEqual([
      { code: 'request.attempt-id', subject: 'request', values: { attemptId: 8n, expected: 7n } },
    ]);
    expect(validateRequest({ ...CANCEL, attemptId: 5n }, CANCEL_CONTEXT).errors).toEqual([
      { code: 'request.attempt-id', subject: 'request', values: { attemptId: 5n, expected: 6n } },
    ]);
  });

  it('raises request.expired once the moment is past validUntil, and not at it', () => {
    const late = { ...REQUEST_CONTEXT, moment: T + 86_401, block: { ...REQUEST_CONTEXT.block, timestamp: T + 86_000 } };
    const onTime = { ...late, moment: T + 86_400 };

    expect(findingsOf(validateRequest(OPENING, late), 'request.expired')).toEqual([
      { code: 'request.expired', subject: 'request', values: { validUntil: T + 86_400, moment: T + 86_401, blockTimestamp: T + 86_000 } },
    ]);
    expect(errorCodes(OPENING, onTime)).toEqual([]);
  });

  it('raises request.attempt-active on an opening while an attempt waits, telling whether it is this request', () => {
    const stranger = { ...REQUEST_CONTEXT, state: WAITING_STATE };
    const own = { ...REQUEST_CONTEXT, state: { ...WAITING_STATE, attempt: { ...WAITING_STATE.attempt, attemptId: 7n } } };

    expect(validateRequest(OPENING, stranger).errors).toEqual([
      { code: 'request.attempt-active', subject: 'request', values: { attemptId: 6n, consumableAfter: T + 172_800, ownRequest: false } },
    ]);
    expect(findingsOf(validateRequest(OPENING, own), 'request.attempt-active')[0]?.values['ownRequest']).toBe(true);
  });

  it('does not raise request.attempt-active once the stored attempt is consumed, cancelled or never opened', () => {
    for (const state of ['Consumed', 'Cancelled', 'None'] as const) {
      expect(errorCodes(OPENING, { ...REQUEST_CONTEXT, state: { ...STATE, attempt: { ...STATE.attempt, state } } })).toEqual([]);
    }
  });

  it('raises request.no-active-attempt on a cancellation of an attempt not waiting, and not of a waiting one', () => {
    expect(validateRequest(CANCEL, REQUEST_CONTEXT).errors).toEqual([
      { code: 'request.no-active-attempt', subject: 'request', values: { action: ACTION, state: 'Consumed' } },
    ]);
    expect(errorCodes(CANCEL, CANCEL_CONTEXT)).toEqual([]);
  });

  it('raises request.stale-attempt on a cancellation after the setup nonce moved, and not before', () => {
    const moved = { ...CANCEL_CONTEXT, state: { ...WAITING_STATE, attempt: { ...WAITING_STATE.attempt, setupNonce: 2n } } };

    expect(validateRequest(CANCEL, moved).errors).toEqual([
      { code: 'request.stale-attempt', subject: 'request', values: { judgedUnder: 2n, currentNonce: 3n } },
    ]);
    expect(errorCodes(CANCEL, CANCEL_CONTEXT)).toEqual([]);
  });

  it('raises request.body-mismatch with the recomputed and committed commitments when the body changed', () => {
    const otherBody = oracleBody({ ...BODY, wait: 172_801 });

    expect(validateRequest({ ...OPENING, setupBody: otherBody }, REQUEST_CONTEXT).errors).toEqual([
      {
        code: 'request.body-mismatch',
        subject: 'request',
        values: { recomputed: oracleCommitment(ACCOUNT, ACTION, 3n, otherBody), committed: STATE.setupCommitment },
      },
    ]);
  });

  it('raises request.body-mismatch for a request under another nonce, and not for the stored body', () => {
    expect(errorCodes({ ...OPENING, setupNonce: 4n })).toEqual(['request.body-mismatch']);
    expect(errorCodes()).toEqual([]);
  });

  it('raises request.rule-unsatisfied naming the clause and its filled count, and not once the threshold is met', () => {
    expect(validateRequest({ ...OPENING, proofs: [OPENING.proofs[0]!] }, REQUEST_CONTEXT).errors).toEqual([
      { code: 'request.rule-unsatisfied', subject: 'request', values: { clause: 0, threshold: 2, filled: 1 } },
    ]);
    expect(errorCodes()).toEqual([]);
  });

  it('counts places per clause across a two-clause body by their flat index', () => {
    const body = {
      ...BODY,
      clauses: [
        { threshold: 1, credentials: [config(21)] },
        { threshold: 2, credentials: [config(22), config(23), config(24)] },
      ],
    };
    const proof = (place: number) => ({ ...OPENING.proofs[0]!, place });
    const [missing, context] = overBody(body, [proof(0), proof(1)]);
    const [met] = overBody(body, [proof(0), proof(1), proof(3)]);

    expect(validateRequest(missing, context).errors).toEqual([
      { code: 'request.rule-unsatisfied', subject: 'request', values: { clause: 1, threshold: 2, filled: 1 } },
    ]);
    expect(errorCodes(met, context)).toEqual([]);
  });

  it('raises request.rule-unsatisfied for an empty rule and an all-zero rule even with proofs', () => {
    const [empty, emptyContext] = overBody({ ...BODY, clauses: [] }, []);
    const [zero, zeroContext] = overBody({ ...BODY, clauses: [{ threshold: 0, credentials: [config(1)] }] }, []);

    expect(findingsOf(validateRequest(empty, emptyContext), 'request.rule-unsatisfied')).toEqual([
      { code: 'request.rule-unsatisfied', subject: 'request', values: { clauses: 0, allThresholdsZero: false } },
    ]);
    expect(findingsOf(validateRequest(zero, zeroContext), 'request.rule-unsatisfied')).toEqual([
      { code: 'request.rule-unsatisfied', subject: 'request', values: { clauses: 1, allThresholdsZero: true } },
    ]);
  });

  it('raises request.method-stopped for a place whose method is paused while stops reach the setup', () => {
    const paused = { ...REQUEST_CONTEXT, paused: [REQUEST_CONTEXT.paused[0]!, { method: PASSKEY, paused: { answered: true as const, value: true } }] };

    expect(validateRequest(OPENING, paused).errors).toEqual([
      { code: 'request.method-stopped', subject: 'request', values: { place: 1, method: PASSKEY, ignoresPause: false } },
    ]);
  });

  it('does not raise request.method-stopped when the setup ignores stops or the pause read went unanswered', () => {
    const pausedReads = [REQUEST_CONTEXT.paused[0]!, { method: PASSKEY, paused: { answered: true as const, value: true } }];
    const [ignoring, ignoringContext] = overBody({ ...BODY, ignoresPause: true });
    const unanswered = { ...REQUEST_CONTEXT, paused: [REQUEST_CONTEXT.paused[0]!, { method: PASSKEY, paused: { answered: false as const } }] };

    expect(errorCodes(ignoring, { ...ignoringContext, paused: pausedReads })).toEqual([]);
    expect(errorCodes(OPENING, unanswered)).toEqual([]);
  });

  it('raises proof.places-unordered for a place out of order and for a repeated place, and not for increasing places', () => {
    const [first, second] = OPENING.proofs as [AttemptRequest['proofs'][0], AttemptRequest['proofs'][0]];

    expect(findingsOf(validateRequest({ ...OPENING, proofs: [second, first] }, REQUEST_CONTEXT), 'proof.places-unordered')).toEqual([
      { code: 'proof.places-unordered', subject: 'request', values: { place: 0 } },
    ]);
    expect(errorCodes({ ...OPENING, proofs: [second, second] })).toContain('proof.places-unordered');
    expect(errorCodes()).not.toContain('proof.places-unordered');
  });

  it('raises handover.removed-not-authority when the removed key holds no power, and not when it does', () => {
    expect(validateRequest(OPENING, withHandover({ removedIsAuthority: false })).errors).toEqual([
      { code: 'handover.removed-not-authority', subject: 'request', values: { removedAuthority: OLD_KEY, isAuthority: false } },
    ]);
    expect(errorCodes(OPENING, withHandover({ removedIsAuthority: true }))).toEqual([]);
  });

  it('raises handover.new-holds-privilege when the new key already holds a privilege, and not otherwise', () => {
    expect(validateRequest(OPENING, withHandover({ newHoldsAnyPrivilege: true })).errors).toEqual([
      { code: 'handover.new-holds-privilege', subject: 'request', values: { newAuthority: NEW_KEY, holdsAnyPrivilege: true } },
    ]);
    expect(errorCodes(OPENING, withHandover({ newHoldsAnyPrivilege: false }))).toEqual([]);
  });

  it('raises handover.same-authority for one address on both sides, and not for two', () => {
    expect(validateRequest(OPENING, withHandover({ handover: { newAuthority: OLD_KEY, removedAuthority: OLD_KEY } })).errors).toEqual([
      { code: 'handover.same-authority', subject: 'request', values: { newAuthority: OLD_KEY, removedAuthority: OLD_KEY } },
    ]);
    expect(errorCodes()).not.toContain('handover.same-authority');
  });

  it('raises handover.malformed for a zero key on either side and for a layout that does not decode', () => {
    expect(findingsOf(validateRequest(OPENING, withHandover({ handover: { newAuthority: ZERO, removedAuthority: OLD_KEY } })), 'handover.malformed')).toEqual([
      { code: 'handover.malformed', subject: 'request', values: { zeroNew: true, zeroRemoved: false, layoutDecodes: true } },
    ]);
    expect(findingsOf(validateRequest(OPENING, withHandover({ handover: { newAuthority: NEW_KEY, removedAuthority: ZERO } })), 'handover.malformed')).toEqual([
      { code: 'handover.malformed', subject: 'request', values: { zeroNew: false, zeroRemoved: true, layoutDecodes: true } },
    ]);
    expect(validateRequest(OPENING, withHandover({ layoutDecodes: false })).errors).toEqual([
      { code: 'handover.malformed', subject: 'request', values: { zeroNew: false, zeroRemoved: false, layoutDecodes: false } },
    ]);
  });

  it('does not raise handover.malformed for two nonzero keys in a decoding layout', () => {
    expect(errorCodes()).not.toContain('handover.malformed');
  });

  it('judges no handover on a cancellation', () => {
    const context = { ...CANCEL_CONTEXT, handover: { ...REQUEST_CONTEXT.handover!, layoutDecodes: false, newHoldsAnyPrivilege: true } };

    expect(errorCodes(CANCEL, context)).toEqual([]);
  });

  it('never raises handover.removed-unknown, even for a handover naming no removed key', () => {
    const result = validateRequest(OPENING, withHandover({ handover: { newAuthority: NEW_KEY } }));

    expect(findingsOf(result, 'handover.removed-unknown')).toEqual([]);
  });

  it('decodes no body from undecodable bytes and still judges the commitment', () => {
    const bytes: Hex = '0x1234';

    expect(errorCodes({ ...OPENING, setupBody: bytes })).toEqual(['request.body-mismatch']);
  });
});

describe('validateRequest: a proof array with a hole', () => {
  const [first] = OPENING.proofs;
  const trailing = [...OPENING.proofs];

  trailing.length += 1;

  it.each<[string, readonly unknown[], number]>([
    ['an entirely sparse array', new Array(1), 0],
    // eslint-disable-next-line no-sparse-arrays
    ['a middle hole', [first, , { ...first, place: (first?.place ?? 0) + 2 }], 1],
    ['a trailing hole', trailing, OPENING.proofs.length],
  ])('throws a TypeError naming the first hole for %s, never a finding', (_name, proofs, index) => {
    expect(() => validateRequest({ ...OPENING, proofs } as Request, REQUEST_CONTEXT)).toThrow(TypeError);
    expect(() => validateRequest({ ...OPENING, proofs } as Request, REQUEST_CONTEXT)).toThrow(`request.proofs[${index}]`);
  });
});

