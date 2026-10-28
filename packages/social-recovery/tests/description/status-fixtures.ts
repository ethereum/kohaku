import type { Address, Attempt, Hex, KitNotification, LogPosition, RecoveryState, SetupState, StatusScope } from '../../src/index';

export const ACCOUNT: Address = '0xabc0000000000000000000000000000000000abc';
export const ACTION: Address = '0xdef0000000000000000000000000000000000def';
export const METHOD_A: Address = '0x3000000000000000000000000000000000000001';
export const METHOD_B: Address = '0x3000000000000000000000000000000000000002';
export const METHOD_C: Address = '0x3000000000000000000000000000000000000003';
export const OTHER_ACCOUNT: Address = '0x1111111111111111111111111111111111111119';
export const OTHER_ACTION: Address = '0x2000000000000000000000000000000000000009';

/** The account and action the status is read for. */
export const SCOPE: StatusScope = { account: ACCOUNT, action: ACTION };

export const HOLDER: Address = '0x6000000000000000000000000000000000000003';
export const TOKEN: Address = '0x5000000000000000000000000000000000000001';
export const ZERO: Address = '0x0000000000000000000000000000000000000000';
export const HASH_ONE: Hex = `0x${'1a'.repeat(32)}`;
export const HASH_TWO: Hex = `0x${'2b'.repeat(32)}`;
export const COMMITMENT: Hex = `0x${'c0'.repeat(32)}`;
export const PAYLOAD: Hex = `0x${'00'.repeat(12)}${'77'.repeat(20)}${'00'.repeat(12)}${'88'.repeat(20)}`;
export const BLOCK_TIME = 1_700_000_000;

/** A log position at the given block and index. */
export const at = (blockNumber: number, logIndex = 0): LogPosition => ({
  blockNumber,
  blockHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
  logIndex,
  transactionHash: `0x${(blockNumber * 1000 + logIndex).toString(16).padStart(64, '0')}`,
  removed: false,
});

export const SETUP_STATE: SetupState = {
  isAuthorized: true,
  hasSetup: true,
  setupCommitment: COMMITMENT,
  setupNonce: 3n,
  setupCommittedAtBlock: 90,
  attemptActive: true,
  block: { number: 100, timestamp: BLOCK_TIME, hash: HASH_ONE },
};

export const WAITING: Attempt = {
  attemptId: 5n,
  setupNonce: 3n,
  consumableAfter: BLOCK_TIME + 172_800,
  state: 'Waiting',
  payloadHash: `0x${'ab'.repeat(32)}`,
  order: { token: TOKEN, amount: 10n, payee: ZERO },
  usedMethods: [METHOD_A, METHOD_B],
  ignoresPause: false,
};

const NO_ATTEMPT: Attempt = {
  attemptId: 0n,
  setupNonce: 0n,
  consumableAfter: 0,
  state: 'None',
  payloadHash: `0x${'00'.repeat(32)}`,
  order: { token: ZERO, amount: 0n, payee: ZERO },
  usedMethods: [],
  ignoresPause: false,
};

export const RECOVERY_STATE: RecoveryState = {
  attempt: WAITING,
  nextAttemptId: 6n,
  setupCommitment: COMMITMENT,
  setupNonce: 3n,
  removedKey: 'no-source',
  block: { number: 100, timestamp: BLOCK_TIME, hash: HASH_ONE },
};

export const IDLE_STATE: RecoveryState = { ...RECOVERY_STATE, attempt: NO_ATTEMPT, nextAttemptId: 5n };

/** The opening notification of the given attempt, filling the given places. */
export const started = (attemptId: bigint, usedPlaces: readonly bigint[], payload: Hex, position: LogPosition): KitNotification => ({
  kind: 'attempt-started',
  account: ACCOUNT,
  action: ACTION,
  attemptId,
  setupNonce: 3n,
  setupBody: '0x00',
  usedPlaces,
  usedMethods: [METHOD_A, METHOD_B],
  payload,
  order: WAITING.order,
  consumableAfter: WAITING.consumableAfter,
  at: position,
});

export const paused = (method: Address, position: LogPosition): KitNotification => ({ kind: 'method-paused', method, by: HOLDER, at: position });

export const unpaused = (method: Address, position: LogPosition): KitNotification => ({ kind: 'method-unpaused', method, by: HOLDER, at: position });
