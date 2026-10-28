import type { Address, BlockHeader, Hex } from './chain';

/** The manager's `AttemptState`, in its declaration order. */
export const ATTEMPT_STATES = ['None', 'Waiting', 'Cancelled', 'Consumed'] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];

/** What the account pays and to whom; a zero payee leaves the order open. */
export type PaymentOrder = {
  readonly token: Address;
  readonly amount: bigint;
  readonly payee: Address;
};

/** The manager's `Attempt`. */
export type Attempt = {
  readonly attemptId: bigint;
  readonly setupNonce: bigint;
  readonly consumableAfter: number;
  readonly state: AttemptState;
  readonly payloadHash: Hex;
  readonly order: PaymentOrder;
  readonly usedMethods: readonly Address[];
  readonly ignoresPause: boolean;
};

/** What `stateOf(account, action)` returns. */
export type ActionState = {
  readonly setupCommitment: Hex;
  readonly setupNonce: bigint;
  readonly nextAttemptId: bigint;
  /** A block number rather than a time. */
  readonly setupCommittedAtBlock: number;
  readonly attempt: Attempt;
};

/** What `eip712Domain()` returns, per ERC-5267. */
export type Domain = {
  readonly fields: Hex;
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: Address;
  readonly salt: Hex;
  readonly extensions: readonly bigint[];
};

/** Why no address could be named for the key a handover would remove. */
export const REMOVED_KEY_UNNAMED = [
  /** No address was supplied, no handover was consumed and no signer was recovered. */
  'no-source',
  /** Every address named was denied by `isAuthority`. */
  'not-a-key',
  /** A read the inference needs failed. */
  'unread',
] as const;

export type RemovedKeyUnnamed = (typeof REMOVED_KEY_UNNAMED)[number];

/** The address a handover would remove, or why none could be named. */
export type RemovedKey = Address | RemovedKeyUnnamed;

/** The recovery-side reading of the bound account at one pinned block. */
export type RecoveryState = {
  readonly attempt: Attempt;
  readonly nextAttemptId: bigint;
  /** The current commitment and nonce, which the restore verifies against. */
  readonly setupCommitment: Hex;
  readonly setupNonce: bigint;
  readonly removedKey: RemovedKey;
  readonly block: BlockHeader;
};

/** The authority a handover adds and the one it removes. */
export type Handover = {
  readonly newAuthority: Address;
  /** Absent only on the init's argument, where the SDK infers the key instead. */
  readonly removedAuthority?: Address;
};

/** The window a gathering init takes, in seconds past the pinned block's timestamp. */
export type ValidityWindow = {
  readonly window: number;
};

/** A method module's identity; `supportsInterface` answers the method interface's ERC-165 probe. */
export type ModuleInfo = {
  readonly name: string;
  readonly version: string;
  readonly supportsInterface: boolean;
};

/** An action's identity; `supportsInterface` answers the policy-action ERC-165 probe. */
export type ActionInfo = {
  readonly name: string;
  readonly version: string;
  readonly supportsInterface: boolean;
};

/** What a method's `trustedParties()` declares. */
export type Parties = {
  readonly admin: Address;
  readonly pendingAdmin: Address;
  readonly trustedKeys: readonly Hex[];
  readonly pauseHolder: Address;
  readonly pendingPauseHolder: Address;
};

/** Whether a module read was answered at all, beside what it answered. */
export type ReadResult<Answer> =
  | { readonly answered: true; readonly value: Answer }
  | { readonly answered: false };
