// The manager's own records under the manager's own names, and the reads of
// the two shared parts. Widths from design/onchain/contracts.md D-103: uint48
// as number, uint64 and uint256 as bigint, a place as number. Line numbers
// are design/offchain/sdk.md unless contracts.md is named.
import type { Address, BlockHeader, Hex } from './chain';

/** The manager's `AttemptState`, in its declaration order (contracts.md l.482). */
export const ATTEMPT_STATES = ['None', 'Waiting', 'Cancelled', 'Consumed'] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];

/** What the account pays and to whom; a zero payee leaves the order open (contracts.md l.436-440, D-204 l.890). */
export type PaymentOrder = {
  readonly token: Address;
  readonly amount: bigint;
  readonly payee: Address;
};

/** The manager's `Attempt` in full (contracts.md l.495-504, D-202 l.642). */
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

/** What `stateOf(account, action)` returns (contracts.md l.485-491, D-202 l.670). */
export type ActionState = {
  readonly setupCommitment: Hex;
  readonly setupNonce: bigint;
  readonly nextAttemptId: bigint;
  /** A block number rather than a time. */
  readonly setupCommittedAtBlock: number;
  readonly attempt: Attempt;
};

/** What `eip712Domain()` returns, per ERC-5267 (contracts.md l.380-382, D-208 l.1651). */
export type Domain = {
  readonly fields: Hex;
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: Address;
  readonly salt: Hex;
  readonly extensions: readonly bigint[];
};

/** The address a handover would remove, or the value saying no creation triple was given (D-202 l.644, D-205 l.1111). */
export type RemovedKey = Address | 'no-creation-triple';

/** The recovery-side reading of the bound account at one pinned block (D-202 l.642-646). */
export type RecoveryState = {
  readonly attempt: Attempt;
  readonly nextAttemptId: bigint;
  /** The current commitment and nonce, which the restore verifies against. */
  readonly setupCommitment: Hex;
  readonly setupNonce: bigint;
  readonly removedKey: RemovedKey;
  readonly block: BlockHeader;
};

/**
 * The two addresses a handover moves (D-202 l.608, D-204 l.898, contracts.md
 * l.1090). `removedAuthority` may be absent only on the init's argument, where
 * the client configuration carries a creation triple (D-201 l.106).
 */
export type Handover = {
  readonly newAuthority: Address;
  readonly removedAuthority?: Address;
};

/** The window a gathering init takes, in seconds past the pinned block's timestamp (usage l.470, l.516, D-202 l.611). */
export type ValidityWindow = {
  readonly window: number;
};

/** A module's name, version and answer to the method interface's ERC-165 probe (D-201 l.112, D-202 l.673). */
export type ModuleInfo = {
  readonly name: string;
  readonly version: string;
  readonly supportsInterface: boolean;
};

/** The action's name, version and answer to the policy-action ERC-165 probe (D-201 l.114, D-202 l.672). */
export type ActionInfo = {
  readonly name: string;
  readonly version: string;
  readonly supportsInterface: boolean;
};

/** The five values a method's `trustedParties()` declares (contracts.md l.670-672, D-201 l.112). */
export type Parties = {
  readonly admin: Address;
  readonly pendingAdmin: Address;
  readonly trustedKeys: readonly Hex[];
  readonly pauseHolder: Address;
  readonly pendingPauseHolder: Address;
};

/** Whether a module read was answered at all, beside what it answered (D-201 l.112, D-202 l.678). */
export type ReadResult<Answer> =
  | { readonly answered: true; readonly value: Answer }
  | { readonly answered: false };
