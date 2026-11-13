import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  RECOVERY_ACTION_FALLBACK_HANDLER_SLOT,
  VALIDATION_RESERVED_DESTINATIONS,
  validateRequest,
  type Address,
  type AttemptRequest,
  type CancelRequest,
  type HandoverReads,
  type Hex,
  type RequestValidationContext,
} from '../../src/index';
import { oracleKitSlot } from '../formats/request-support';
import { oracleBody, oracleCommitment } from '../formats/support';
import {
  ACCOUNT,
  ACTION,
  BODY,
  CANCEL,
  CANCEL_CONTEXT,
  DESCRIPTOR,
  NEW_KEY,
  OLD_KEY,
  OPENING,
  OTHER_ACTION,
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

  it('raises request.setup-nonce, not request.body-mismatch, for a request under another nonce over the stored body', () => {
    expect(validateRequest({ ...OPENING, setupNonce: 4n }, REQUEST_CONTEXT).errors).toEqual([
      { code: 'request.setup-nonce', subject: 'request', values: { setupNonce: 4n, expected: 3n } },
    ]);
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


/** The kit slot of `ACTION`, the `normal` row of the kit-slot vector. */
const KIT_SLOT = getAddress('0xb64cddd1b613c46e97677526c0cd0115cf105553');
const FALLBACK_HANDLER: Address = '0x0000000000000000000000000000000000006969';

/** Each address a handover must not install, with the destination name the finding reports for it. */
const RESERVED: readonly (readonly [string, Address])[] = [
  ['account', ACCOUNT],
  ['manager', DESCRIPTOR.manager],
  ['action', ACTION],
  ['kit-slot', KIT_SLOT],
  ['fallback-handler', FALLBACK_HANDLER],
];

/** The healthy opening's context with the handover installing `newAuthority` in place of `OLD_KEY`. */
const handingTo = (newAuthority: Address, extra: Partial<HandoverReads> = {}): RequestValidationContext =>
  withHandover({ handover: { newAuthority, removedAuthority: OLD_KEY }, ...extra });

/** The address in lower case with its first or last hex digit changed. */
const nibbleAway = (address: Address, at: 'first' | 'last'): Address => {
  const digits = address.slice(2).toLowerCase();
  const index = at === 'first' ? 0 : digits.length - 1;
  const changed = (Number.parseInt(digits.charAt(index), 16) ^ 1).toString(16);

  return `0x${digits.slice(0, index)}${changed}${digits.slice(index + 1)}`;
};

/** The healthy opening's handover reads with no `manager` member at all. */
const WITHOUT_MANAGER = Object.fromEntries(
  Object.entries(REQUEST_CONTEXT.handover!).filter(([key]) => key !== 'manager'),
) as unknown as HandoverReads;

describe('the reserved destinations', () => {
  it('VALIDATION_RESERVED_DESTINATIONS lists the five names in the order a match is looked for', () => {
    expect([...VALIDATION_RESERVED_DESTINATIONS]).toEqual(['account', 'manager', 'action', 'kit-slot', 'fallback-handler']);
  });

  it('RECOVERY_ACTION_FALLBACK_HANDLER_SLOT is the address 0x…6969', () => {
    expect(RECOVERY_ACTION_FALLBACK_HANDLER_SLOT).toBe('0x0000000000000000000000000000000000006969');
  });
});

describe('validateRequest: a new key nobody can sign for', () => {
  it.each(RESERVED)('raises handover.new-reserved as %s for that new key, and no other error', (reserved, newAuthority) => {
    expect(validateRequest(OPENING, handingTo(newAuthority)).errors).toEqual([
      { code: 'handover.new-reserved', subject: 'request', values: { newAuthority, reserved } },
    ]);
  });

  it('raises the kit slot after handover.new-holds-privilege where the slot already holds a privilege', () => {
    expect(validateRequest(OPENING, handingTo(KIT_SLOT, { newHoldsAnyPrivilege: true })).errors).toEqual([
      { code: 'handover.new-holds-privilege', subject: 'request', values: { newAuthority: KIT_SLOT, holdsAnyPrivilege: true } },
      { code: 'handover.new-reserved', subject: 'request', values: { newAuthority: KIT_SLOT, reserved: 'kit-slot' } },
    ]);
  });

  it.each<[string, Address]>([
    ['in lower case', KIT_SLOT.toLowerCase() as Address],
    ['in upper case', `0x${KIT_SLOT.slice(2).toUpperCase()}`],
    ['checksummed', KIT_SLOT],
  ])('reports the kit slot spelled %s as its checksummed address', (_spelling, newAuthority) => {
    expect(findingsOf(validateRequest(OPENING, handingTo(newAuthority)), 'handover.new-reserved')).toEqual([
      { code: 'handover.new-reserved', subject: 'request', values: { newAuthority: KIT_SLOT, reserved: 'kit-slot' } },
    ]);
  });

  it.each(RESERVED.flatMap(([reserved, address]) => (['first', 'last'] as const).map((at) => [reserved, at, nibbleAway(address, at)] as const)))(
    'raises nothing for the %s address with its %s digit changed',
    (_reserved, _at, near) => {
      expect(errorCodes(OPENING, handingTo(near))).toEqual([]);
    },
  );

  it('raises nothing for the kit slot of another action', () => {
    expect(errorCodes(OPENING, handingTo(oracleKitSlot(OTHER_ACTION)))).toEqual([]);
  });

  it('raises handover.malformed alone for a zero new key', () => {
    expect(validateRequest(OPENING, handingTo(ZERO)).errors).toEqual([
      { code: 'handover.malformed', subject: 'request', values: { zeroNew: true, zeroRemoved: false, layoutDecodes: true } },
    ]);
  });

  it('names the account, the first match, where the manager read is the account itself', () => {
    expect(validateRequest(OPENING, handingTo(ACCOUNT, { manager: ACCOUNT })).errors).toEqual([
      { code: 'handover.new-reserved', subject: 'request', values: { newAuthority: ACCOUNT, reserved: 'account' } },
    ]);
  });

  it('judges no reserved key on a cancellation, nor its missing manager read', () => {
    const reserved = { ...CANCEL_CONTEXT, handover: { ...REQUEST_CONTEXT.handover!, handover: { newAuthority: ACCOUNT, removedAuthority: OLD_KEY } } };

    expect(errorCodes(CANCEL, reserved)).toEqual([]);
    expect(errorCodes(CANCEL, { ...CANCEL_CONTEXT, handover: { ...WITHOUT_MANAGER, handover: { newAuthority: ACCOUNT, removedAuthority: OLD_KEY } } })).toEqual([]);
  });

  it.each<[string, HandoverReads]>([
    ['no manager member', WITHOUT_MANAGER],
    ['an undefined manager', { ...REQUEST_CONTEXT.handover!, manager: undefined as never }],
    ['a short hex manager', { ...REQUEST_CONTEXT.handover!, manager: '0x1234' }],
    ['a number', { ...REQUEST_CONTEXT.handover!, manager: 7 as never }],
    ['a mixed-case manager whose checksum fails', { ...REQUEST_CONTEXT.handover!, manager: `0x${KIT_SLOT.slice(2).replace(/[a-f]/, (letter) => letter.toUpperCase())}` }],
  ])('throws a TypeError naming context.handover.manager for %s on an opening, never a finding', (_label, handover) => {
    expect(() => validateRequest(OPENING, { ...REQUEST_CONTEXT, handover })).toThrow(TypeError);
    expect(() => validateRequest(OPENING, { ...REQUEST_CONTEXT, handover })).toThrow('context.handover.manager');
  });
});

/** The commitment the manager holds for an account and action with no setup standing. */
const NO_SETUP: Hex = `0x${'00'.repeat(32)}`;

/** The stored state after a clear: no commitment, the nonce moved one past the requests', no attempt waiting. */
const CLEARED = { ...STATE, setupCommitment: NO_SETUP, setupNonce: 4n, attempt: { ...STATE.attempt, state: 'Cancelled' as const } };

/** A body other than the one the stored commitment holds. */
const OTHER_BODY = oracleBody({ ...BODY, wait: 172_801 });

describe('validateRequest: the setup a request stands on', () => {
  it.each<[string, Request, RequestValidationContext]>([
    ['an opening', OPENING, REQUEST_CONTEXT],
    ['a cancellation', CANCEL, CANCEL_CONTEXT],
  ])('raises request.setup-nonce alone on %s under a nonce other than the stored one, over the stored body', (_kind, request, context) => {
    for (const setupNonce of [0n, 2n, 4n, 2n ** 64n - 1n]) {
      expect(validateRequest({ ...request, setupNonce }, context).errors).toEqual([
        { code: 'request.setup-nonce', subject: 'request', values: { setupNonce, expected: 3n } },
      ]);
    }
  });

  it('raises request.setup-nonce then request.body-mismatch, recomputed under the stored nonce, for a moved nonce over a changed body', () => {
    expect(validateRequest({ ...OPENING, setupNonce: 4n, setupBody: OTHER_BODY }, REQUEST_CONTEXT).errors).toEqual([
      { code: 'request.setup-nonce', subject: 'request', values: { setupNonce: 4n, expected: 3n } },
      {
        code: 'request.body-mismatch',
        subject: 'request',
        values: { recomputed: oracleCommitment(ACCOUNT, ACTION, 3n, OTHER_BODY), committed: STATE.setupCommitment },
      },
    ]);
  });

  it.each<[string, Hex]>([
    ['the zero word', NO_SETUP],
    ['the zero word with an upper-case prefix', `0X${'00'.repeat(32)}` as Hex],
  ])('raises request.no-setup naming the account and action, and no request.body-mismatch, on an opening over %s', (_spelling, setupCommitment) => {
    const context = { ...REQUEST_CONTEXT, state: { ...STATE, setupCommitment } };
    const noSetup = { code: 'request.no-setup', subject: 'request', values: { account: ACCOUNT, action: ACTION } };

    expect(validateRequest(OPENING, context).errors).toEqual([noSetup]);
    expect(validateRequest({ ...OPENING, setupBody: OTHER_BODY }, context).errors).toEqual([noSetup]);
  });

  it('reports the account and action of request.no-setup checksummed, whatever their spelling in the request', () => {
    const account: Address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const action: Address = '0xfedcbafedcbafedcbafedcbafedcbafedcbafedc';

    expect(validateRequest({ ...OPENING, account, action }, { ...REQUEST_CONTEXT, state: { ...STATE, setupCommitment: NO_SETUP } }).errors).toEqual([
      { code: 'request.no-setup', subject: 'request', values: { account: getAddress(account), action: getAddress(action) } },
    ]);
  });

  it('raises request.no-setup then request.setup-nonce on an opening built before a clear', () => {
    expect(validateRequest(OPENING, { ...REQUEST_CONTEXT, state: CLEARED }).errors).toEqual([
      { code: 'request.no-setup', subject: 'request', values: { account: ACCOUNT, action: ACTION } },
      { code: 'request.setup-nonce', subject: 'request', values: { setupNonce: 3n, expected: 4n } },
    ]);
  });

  it('raises request.no-active-attempt and request.setup-nonce on a cancellation after a clear, and neither request.no-setup nor request.body-mismatch', () => {
    expect(validateRequest(CANCEL, { ...CANCEL_CONTEXT, state: CLEARED }).errors).toEqual([
      { code: 'request.no-active-attempt', subject: 'request', values: { action: ACTION, state: 'Cancelled' } },
      { code: 'request.setup-nonce', subject: 'request', values: { setupNonce: 3n, expected: 4n } },
    ]);
  });

  it('orders an opening\'s state errors as the manager checks them: no setup, a live attempt, the nonce, the id, then the body', () => {
    const request = { ...OPENING, setupNonce: 4n, attemptId: 8n };

    expect(errorCodes(request, { ...REQUEST_CONTEXT, state: { ...WAITING_STATE, setupCommitment: NO_SETUP } })).toEqual([
      'request.no-setup',
      'request.attempt-active',
      'request.setup-nonce',
      'request.attempt-id',
    ]);
    expect(errorCodes({ ...request, setupBody: OTHER_BODY }, { ...REQUEST_CONTEXT, state: WAITING_STATE })).toEqual([
      'request.attempt-active',
      'request.setup-nonce',
      'request.attempt-id',
      'request.body-mismatch',
    ]);
  });

  it('orders a cancellation\'s state errors as the manager checks them: no live attempt, the nonce, the id, a moved attempt nonce', () => {
    const stale = { ...CANCEL_CONTEXT, state: { ...WAITING_STATE, attempt: { ...WAITING_STATE.attempt, setupNonce: 2n } } };

    expect(errorCodes({ ...CANCEL, setupNonce: 4n, attemptId: 5n }, stale)).toEqual(['request.setup-nonce', 'request.attempt-id', 'request.stale-attempt']);
    expect(errorCodes({ ...CANCEL, setupNonce: 4n }, REQUEST_CONTEXT)).toEqual(['request.no-active-attempt', 'request.setup-nonce']);
  });
});
