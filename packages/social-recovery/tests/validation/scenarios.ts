import type { AttemptRequest, CancelRequest, Hex, MethodCost, RequestValidationContext, SetupDraft, SetupValidationContext } from '../../src/index';
import { oracleBody, oracleCommitment } from '../formats/support';
import {
  AADHAAR,
  ACCOUNT,
  ACTION,
  BODY,
  CANCEL,
  CANCEL_CONTEXT,
  CONFIGURATION,
  DRAFT,
  ECDSA,
  OLD_KEY,
  OPENING,
  OTHER_ACTION,
  OTHER_IMPLEMENTATION,
  OTHER_TOKEN,
  PASSKEY,
  REQUEST_CONTEXT,
  SALT,
  SETUP_CONTEXT,
  STATE,
  T,
  UNSHIPPED,
  WAITING_STATE,
  ZERO,
  ZKPASSPORT,
  credential,
  methodReads,
  withClauses,
} from './fixtures';

const COSTS: MethodCost[] = [
  { method: ECDSA, gas: 3_000_000 },
  { method: PASSKEY, gas: 4_000_000 },
];

const many = (count: number) => Array.from({ length: count }, (_, n) => credential(n % 2 === 0 ? ECDSA : PASSKEY, n + 1));

const wide = (n: number): Hex => `0x${n.toString(16).padStart(192, '0')}`;

const committed = (account: string, action: string, block: number) => ({
  kind: 'setup-committed' as const,
  account: account as Hex,
  action: action as Hex,
  nonce: 2n,
  setupCommitment: `0x${'55'.repeat(32)}` as Hex,
  publicMetadata: '0x' as Hex,
  privateMetadata: '0x' as Hex,
  at: { blockNumber: block, blockHash: `0x${'33'.repeat(32)}` as Hex, logIndex: 0, transactionHash: `0x${'44'.repeat(32)}` as Hex, removed: false },
});

/**
 * Setup drafts that, taken together, fire every setup code; the first three fire every error that can co-occur.
 * The empty rule, the all-zero rule and the over-count clause each exclude the others and the cost check.
 */
export function setupScenarios(): readonly [string, SetupDraft, SetupValidationContext][] {
  const deadAction = {
    ...SETUP_CONTEXT,
    action: { ...SETUP_CONTEXT.action, supportsAccount: false },
    configuration: { ...CONFIGURATION, accountImplementation: OTHER_IMPLEMENTATION },
    costs: COSTS,
  };
  const huge = UINT48_TOP - T + 1;
  const widest = Array.from({ length: 256 }, (_, n) => ({ method: PASSKEY, config: wide(n + 1), salt: SALT }));

  return [
    ['every error beside a wide rule', withClauses(
      [{ threshold: 256, credentials: [...widest, widest[0]!] }, { threshold: 0, credentials: [] }],
      { wait: huge },
    ), deadAction],
    ['every error beside an empty rule', withClauses([], { wait: huge }), deadAction],
    ['every error beside an all-zero rule', withClauses([{ threshold: 0, credentials: [credential(ECDSA, 1)] }]), SETUP_CONTEXT],
    ['an over-count clause', withClauses([{ threshold: 3, credentials: many(2) }]), SETUP_CONTEXT],
    ['a single point, a zero clause', withClauses([{ threshold: 0, credentials: [credential(ECDSA, 1)] }, { threshold: 1, credentials: [credential(PASSKEY, 2)] }]), SETUP_CONTEXT],
    ['a shared failure', withClauses([{ threshold: 2, credentials: [credential(ECDSA, 1), credential(ECDSA, 2), credential(ECDSA, 3)] }]), SETUP_CONTEXT],
    ['a secondary clause', withClauses([{ threshold: 1, credentials: [credential(AADHAAR, 1), credential(ZKPASSPORT, 2)] }]), SETUP_CONTEXT],
    ['an unshipped, undeclared, stopped method', withClauses([{ threshold: 1, credentials: [credential(UNSHIPPED, 1), credential(ECDSA, 2)] }]), {
      ...SETUP_CONTEXT,
      methods: [...SETUP_CONTEXT.methods.filter((reads) => reads.module !== UNSHIPPED), methodReads(UNSHIPPED, 'primary', {
        trustedParties: { answered: false },
        paused: { answered: true, value: true },
      })],
    }],
    ['an unaudited, unsupported action and another armed action', DRAFT, {
      ...SETUP_CONTEXT,
      descriptor: { ...SETUP_CONTEXT.descriptor, auditedActions: [] },
      action: { ...SETUP_CONTEXT.action, supportsAccount: false },
      managerEvents: [committed(ACCOUNT, OTHER_ACTION, 10)],
    }],
    ['an undeployed account', DRAFT, { ...SETUP_CONTEXT, action: { ...SETUP_CONTEXT.action, accountHoldsCode: false } }],
    ['a short wait and a clear backup', { ...DRAFT, wait: 60, privacy: { publicMetadata: '0x', backup: 'clear' } }, SETUP_CONTEXT],
    ['a zero wait, no backup, a repeated person', withClauses(
      [{ threshold: 2, credentials: [credential(ECDSA, 1, { label: 'a' }), credential(PASSKEY, 2), credential(ECDSA, 3, { label: 'a' })] }],
      { wait: 0, privacy: { publicMetadata: '0x', backup: 'empty' } },
    ), SETUP_CONTEXT],
  ];
}

const UINT48_TOP = 2 ** 48 - 1;

/** An opening over a body the stored commitment does not match, firing every opening error at once. */
export function everyOpeningError(): [AttemptRequest, RequestValidationContext] {
  const second = OPENING.proofs[1]!;

  return [
    { ...OPENING, attemptId: 9n, setupNonce: 4n, proofs: [second, second, { ...second, place: 5 }] },
    {
      ...REQUEST_CONTEXT,
      state: WAITING_STATE,
      moment: T + 90_000,
      block: { ...REQUEST_CONTEXT.block, timestamp: T + 89_500 },
      paused: [REQUEST_CONTEXT.paused[0]!, { method: PASSKEY, paused: { answered: true, value: true } }],
      handover: { handover: { newAuthority: OLD_KEY, removedAuthority: OLD_KEY }, layoutDecodes: false, removedIsAuthority: false, newHoldsAnyPrivilege: true },
    },
  ];
}

/** Requests that, taken together, fire every request code validation produces. */
export function requestScenarios(): readonly [string, AttemptRequest | CancelRequest, RequestValidationContext][] {
  const lateCancel = { ...CANCEL, validUntil: T + 172_801 + 900 };
  const unmatched = { ...CANCEL, attemptId: 6n, setupBody: oracleBody({ ...BODY, wait: 1 }), proofs: [OPENING.proofs[0]!] };

  return [
    ['every opening error', ...everyOpeningError()],
    ['a cancellation of nothing', unmatched, { ...REQUEST_CONTEXT, moment: T + 50_000 }],
    ['a stale cancellation', { ...CANCEL, attemptId: 5n }, {
      ...CANCEL_CONTEXT,
      state: { ...WAITING_STATE, attempt: { ...WAITING_STATE.attempt, setupNonce: 2n }, setupCommitment: oracleCommitment(ACCOUNT, ACTION, 3n, CANCEL.setupBody) },
    }],
    ['a cancellation read at a skewed moment', lateCancel, { ...CANCEL_CONTEXT, moment: T + 1_000 }],
    ['every payment warning', { ...OPENING, validUntil: T + 300_000, order: { token: OTHER_TOKEN, amount: 5n, payee: ZERO } }, {
      ...REQUEST_CONTEXT,
      balance: 1n,
      implementedMethods: [],
      state: STATE,
    }],
  ];
}
