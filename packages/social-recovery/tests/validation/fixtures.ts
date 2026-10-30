import type {
  ActionState,
  Address,
  AttemptRequest,
  CancelRequest,
  ClientConfiguration,
  Clause,
  Credential,
  DeploymentDescriptor,
  Finding,
  Hex,
  MethodReads,
  RequestValidationContext,
  SetupDraft,
  SetupValidationContext,
  ValidationResult,
} from '../../src/index';
import { oracleBody, oracleCommitment } from '../formats/support';

/** The pinned block's timestamp every fixture is measured from. */
export const T = 1_700_000_000;

export const ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
export const ACTION: Address = '0x2222222222222222222222222222222222222222';
export const OTHER_ACTION: Address = '0x2222222222222222222222222222222222222229';
export const ECDSA: Address = '0x3000000000000000000000000000000000000001';
export const PASSKEY: Address = '0x3000000000000000000000000000000000000002';
export const AADHAAR: Address = '0x3000000000000000000000000000000000000003';
export const ZKPASSPORT: Address = '0x3000000000000000000000000000000000000004';
export const UNSHIPPED: Address = '0x3000000000000000000000000000000000000009';
export const SERVED_IMPLEMENTATION: Address = '0x4000000000000000000000000000000000000001';
export const OTHER_IMPLEMENTATION: Address = '0x4000000000000000000000000000000000000002';
export const TOKEN: Address = '0x5000000000000000000000000000000000000001';
export const OTHER_TOKEN: Address = '0x5000000000000000000000000000000000000002';
export const PAYEE: Address = '0x6000000000000000000000000000000000000001';
export const NEW_KEY: Address = '0x7000000000000000000000000000000000000001';
export const OLD_KEY: Address = '0x7000000000000000000000000000000000000002';
export const ZERO: Address = '0x0000000000000000000000000000000000000000';
export const SALT: Hex = '0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5';

/** The shipped client numbers: 48 h default and short wait, 30 d maximum, a 24 h window with a 1 h floor, 12 h cancel, 10 M gas. */
export const CONFIGURATION: ClientConfiguration = {
  defaultWait: 172_800,
  shortWait: 172_800,
  maxWait: 2_592_000,
  requestWindow: { default: 86_400, floor: 3_600 },
  cancelWindow: 43_200,
  ruleCostBound: 10_000_000,
  candidateKeys: [],
  blockTags: { read: 'latest', watch: 'finalized' },
  logChunkSize: 10_000,
  tokens: [TOKEN],
  simulate: true,
};

export const DESCRIPTOR: DeploymentDescriptor = {
  chainId: 1,
  manager: '0x8000000000000000000000000000000000000001',
  methodEcdsa: ECDSA,
  methodPasskey: PASSKEY,
  methodAadhaar: AADHAAR,
  methodZkpassport: ZKPASSPORT,
  action: ACTION,
  servedImplementation: SERVED_IMPLEMENTATION,
  deployedAt: 1,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [ECDSA, PASSKEY, AADHAAR, ZKPASSPORT],
  auditedActions: [ACTION],
};

/** A 32-byte config word ending in the given number, distinct per number. */
export const config = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`;

export const credential = (method: Address, n: number, extra: Partial<Credential> = {}): Credential => ({
  method,
  config: config(n),
  ...extra,
});

/** Healthy reads for one method module of the given tier. */
export const methodReads = (module: Address, tier: 'primary' | 'secondary', extra: Partial<MethodReads> = {}): MethodReads => ({
  module,
  moduleInfo: { answered: true, value: { name: 'm', version: '1', supportsInterface: true } },
  trustedParties: {
    answered: true,
    value: { admin: ZERO, pendingAdmin: ZERO, trustedKeys: [], pauseHolder: ZERO, pendingPauseHolder: ZERO },
  },
  paused: { answered: true, value: false },
  implemented: true,
  tier,
  ...extra,
});

/** A draft that raises nothing: 2-of-3 over two primary methods, a 48 h wait, an encrypted backup. */
export const DRAFT: SetupDraft = {
  wait: 172_800,
  ignoresPause: false,
  clauses: [{ threshold: 2, credentials: [credential(ECDSA, 1), credential(PASSKEY, 2), credential(ECDSA, 3)] }],
  privacy: { publicMetadata: '0x', backup: 'encrypted' },
};

export const SETUP_CONTEXT: SetupValidationContext = {
  account: ACCOUNT,
  descriptor: DESCRIPTOR,
  descriptorOrigin: 'kit',
  configuration: CONFIGURATION,
  block: { number: 100, timestamp: T, hash: `0x${'11'.repeat(32)}` },
  methods: [
    methodReads(ECDSA, 'primary'),
    methodReads(PASSKEY, 'primary'),
    methodReads(AADHAAR, 'secondary'),
    methodReads(ZKPASSPORT, 'secondary'),
    methodReads(UNSHIPPED, 'primary'),
  ],
  action: {
    address: ACTION,
    actionInfo: { answered: true, value: { name: 'a', version: '1', supportsInterface: true } },
    supportsAccount: true,
  },
  managerEvents: [],
  costs: [],
};

export const withClauses = (clauses: readonly Clause[], extra: Partial<SetupDraft> = {}): SetupDraft => ({
  ...DRAFT,
  clauses,
  ...extra,
});

export const BODY = {
  wait: 172_800,
  ignoresPause: false,
  clauses: [{ threshold: 2, credentials: [config(11), config(12), config(13)] }],
};

export const BODY_HEX: Hex = oracleBody(BODY);

/** An opening request for attempt 7 under nonce 3, filling places 0 and 1. */
export const OPENING: AttemptRequest = {
  account: ACCOUNT,
  action: ACTION,
  attemptId: 7n,
  setupNonce: 3n,
  setupBody: BODY_HEX,
  payload: '0x1234',
  order: { token: TOKEN, amount: 1_000n, payee: PAYEE },
  validUntil: T + 86_400,
  proofs: [
    { place: 0, method: ECDSA, config: config(1), salt: SALT, proof: '0x01' },
    { place: 1, method: PASSKEY, config: config(2), salt: SALT, proof: '0x02' },
  ],
};

/** A cancellation of the waiting attempt 6, filling places 0 and 1, closing before it becomes spendable. */
export const CANCEL: CancelRequest = {
  account: ACCOUNT,
  action: ACTION,
  attemptId: 6n,
  setupNonce: 3n,
  setupBody: BODY_HEX,
  validUntil: T + 43_200,
  proofs: OPENING.proofs,
};

const ATTEMPT = {
  attemptId: 6n,
  setupNonce: 3n,
  consumableAfter: T - 10,
  state: 'Consumed' as const,
  payloadHash: `0x${'22'.repeat(32)}` as Hex,
  order: OPENING.order,
  usedMethods: [],
  ignoresPause: false,
};

export const STATE: ActionState = {
  setupCommitment: oracleCommitment(ACCOUNT, ACTION, 3n, BODY_HEX),
  setupNonce: 3n,
  nextAttemptId: 7n,
  setupCommittedAtBlock: 50,
  attempt: ATTEMPT,
};

/** The stored state a cancellation of attempt 6 reads: it waits until 48 h past the block. */
export const WAITING_STATE: ActionState = {
  ...STATE,
  attempt: { ...ATTEMPT, state: 'Waiting', consumableAfter: T + 172_800 },
};

export const REQUEST_CONTEXT: RequestValidationContext = {
  state: STATE,
  block: { number: 100, timestamp: T, hash: `0x${'11'.repeat(32)}` },
  moment: T,
  configuration: CONFIGURATION,
  paused: [
    { method: ECDSA, paused: { answered: true, value: false } },
    { method: PASSKEY, paused: { answered: true, value: false } },
  ],
  implementedMethods: [ECDSA, PASSKEY],
  handover: {
    handover: { newAuthority: NEW_KEY, removedAuthority: OLD_KEY },
    layoutDecodes: true,
    removedIsAuthority: true,
    newHoldsAnyPrivilege: false,
  },
  balance: 1_000n,
};

export const CANCEL_CONTEXT: RequestValidationContext = { ...REQUEST_CONTEXT, state: WAITING_STATE };

/** Every finding's code, errors then warnings. */
export const codesOf = (result: ValidationResult): string[] => [...result.errors, ...result.warnings].map((finding) => finding.code);

/** The findings carrying one code, from either list. */
export const findingsOf = (result: ValidationResult, code: string): Finding[] =>
  [...result.errors, ...result.warnings].filter((finding) => finding.code === code);
