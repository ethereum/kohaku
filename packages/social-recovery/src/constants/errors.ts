import type { AbiErrorItem, AbiParameter, ErrorAbi, KitErrorSource } from '../interfaces/records';

const input = (name: string, type: string): AbiParameter => ({ name, type });

const error = (name: string, ...inputs: readonly AbiParameter[]): AbiErrorItem => ({ type: 'error', name, inputs });

/** The policy manager's errors, written by hand from its Solidity declarations. */
export const ERRORS_MANAGER_ABI: ErrorAbi = [
  error('PolicyManager_InvalidCommitment', input('supplied', 'bytes32')),
  error('PolicyManager_WrongSetupNonce', input('supplied', 'uint64'), input('expected', 'uint64')),
  error('PolicyManager_ActionDoesNotServeAccount', input('account', 'address'), input('action', 'address')),
  error('PolicyManager_PlaceOutOfRange', input('place', 'uint256'), input('count', 'uint256')),
  error('PolicyManager_NoSetup', input('account', 'address'), input('action', 'address')),
  error('PolicyManager_NoActiveAttempt', input('account', 'address'), input('action', 'address')),
  error('PolicyManager_AttemptAlreadyActive', input('account', 'address'), input('action', 'address'), input('attemptId', 'uint64')),
  error('PolicyManager_WrongAttemptId', input('supplied', 'uint64'), input('expected', 'uint64')),
  error('PolicyManager_SetupCommitmentMismatch', input('recomputed', 'bytes32'), input('committed', 'bytes32')),
  error('PolicyManager_StaleAttempt', input('judgedUnder', 'uint64'), input('currentNonce', 'uint64')),
  error('PolicyManager_CredentialMismatch', input('place', 'uint256'), input('recomputed', 'bytes32')),
  error('PolicyManager_PlacesNotStrictlyIncreasing', input('place', 'uint256')),
  error('PolicyManager_RequestExpired', input('blockTimestamp', 'uint48'), input('validUntil', 'uint48')),
  error('PolicyManager_ProofRejected', input('place', 'uint256'), input('method', 'address')),
  error('PolicyManager_MethodStopped', input('place', 'uint256'), input('method', 'address')),
  error('PolicyManager_MethodVetoedSpend', input('method', 'address')),
  error('PolicyManager_MethodNotUsed', input('attemptId', 'uint64'), input('method', 'address')),
  error('PolicyManager_AttemptIgnoresPause', input('attemptId', 'uint64')),
  error('PolicyManager_MethodNotStopped', input('method', 'address')),
  error('PolicyManager_RuleUnsatisfied', input('clause', 'uint256')),
  error('PolicyManager_WaitNotOver', input('blockTimestamp', 'uint48'), input('consumableAfter', 'uint48')),
  error('PolicyManager_WrongPayload', input('supplied', 'bytes32'), input('committed', 'bytes32')),
];

/** The recovery action contract's errors; `state` is the manager's `AttemptState` enum, encoded as `uint8`. */
export const ERRORS_ACTION_ABI: ErrorAbi = [
  error('RecoveryAction_BatchNotApproved', input('callIndex', 'uint256')),
  error('RecoveryAction_MalformedHandover', input('payload', 'bytes')),
  error('RecoveryAction_NotAKey', input('authority', 'address')),
  error('RecoveryAction_AlreadyPrivileged', input('authority', 'address')),
  error(
    'RecoveryAction_NotConsumable',
    input('account', 'address'),
    input('state', 'uint8'),
    input('consumableAfter', 'uint48'),
    input('committedPayloadHash', 'bytes32'),
  ),
  error('RecoveryAction_AccountNotServed', input('account', 'address')),
];

/** The account's own errors; empty until the account revision the action serves is pinned. */
export const ERRORS_ACCOUNT_ABI: ErrorAbi = [];

/** The two errors the Solidity language itself raises. */
export const ERRORS_LANGUAGE_ABI: ErrorAbi = [error('Panic', input('reason', 'uint256')), error('Error', input('message', 'string'))];

/** The error ABI set by the source that raises each error. */
export const ERRORS_ABI_BY_SOURCE: { readonly [Source in KitErrorSource]: ErrorAbi } = {
  manager: ERRORS_MANAGER_ABI,
  action: ERRORS_ACTION_ABI,
  account: ERRORS_ACCOUNT_ABI,
  language: ERRORS_LANGUAGE_ABI,
};

/** Every error `decodeRevert` names, exported for a decoder the SDK does not reach. */
export const ERRORS_ABI: ErrorAbi = [...ERRORS_MANAGER_ABI, ...ERRORS_ACTION_ABI, ...ERRORS_ACCOUNT_ABI, ...ERRORS_LANGUAGE_ABI];

/** The width of an error selector, in bytes. */
export const ERRORS_SELECTOR_SIZE = 4;

/** The ABI type prefix of a tuple, spelled out as its components in a canonical signature. */
export const ERRORS_TUPLE_TYPE = 'tuple';

/** The ABI type whose decoded text may not carry its bytes back, so its round trip is checked as `bytes`. */
export const ERRORS_STRING_TYPE = 'string';

/** The ABI type a `string` argument is read as for its byte-level round trip. */
export const ERRORS_BYTES_TYPE = 'bytes';
