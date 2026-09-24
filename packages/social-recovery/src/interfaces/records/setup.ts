// The setup side's records: the draft, the configuration, its source, the
// confirmation and the setup state (D-202). Line numbers are
// design/offchain/sdk.md.
import type { Address, BlockHeader, Hex, LogPosition } from './chain';

/**
 * One credential: its method's address and its config in that method's layout,
 * an optional contact-book `label` the commitment does not cover, and the salt
 * the holder supplied where they supplied one (D-202 l.586-587, l.650, usage l.436).
 */
export type Credential = {
  readonly method: Address;
  readonly config: Hex;
  readonly label?: string;
  /** Absent where the default `keccak256(account, place)` applies. */
  readonly salt?: Hex;
};

/** One clause: its `uint8` threshold and its credentials (D-202 l.586, D-204 l.854). */
export type Clause = {
  readonly threshold: number;
  readonly credentials: readonly Credential[];
};

/** The backup's three states (D-204 l.925, D-202 l.593). */
export const BACKUP_CHOICES = ['encrypted', 'clear', 'empty'] as const;

export type BackupChoice = (typeof BACKUP_CHOICES)[number];

/** The holder's privacy dial and backup choice, which no chain field carries (D-202 l.592-593, l.652, usage l.441). */
export type DraftPrivacy = {
  readonly publicMetadata: Hex;
  readonly backup: BackupChoice;
};

/** The arrangement a holder wrote on a screen, before one commit (D-202 l.586, l.652, usage l.434-442). */
export type SetupDraft = {
  /** Seconds, the body's `uint48` wait. */
  readonly wait: number;
  readonly clauses: readonly Clause[];
  /** Whether a method's stop reaches this holder's attempts, per D-111. */
  readonly ignoresPause: boolean;
  readonly privacy: DraftPrivacy;
};

/** The holder's readable copy of their own setup: what the commitment closes over, and not a draft (D-202 l.650-652). */
export type Configuration = {
  readonly clauses: readonly Clause[];
  readonly wait: number;
  readonly ignoresPause: boolean;
};

/**
 * A restore's source: the password that opens the backup, or the configuration
 * itself (D-202 l.654, usage l.465-467). `Configuration` has no `password` field
 * and no index signature, so `'password' in source` tells the two apart.
 */
export type ConfigurationSource = { readonly password: string } | Configuration;

/** What `confirmSetup` yields (D-202 l.597). */
export type SetupConfirmation = {
  /** Whether the event at the predicted nonce was found with that commitment. */
  readonly landed: boolean;
  readonly nonce: bigint;
  readonly setupCommitment: Hex;
  readonly isAuthorized: boolean;
  /** The event's log position, where one was found. */
  readonly position?: LogPosition;
};

/** The setup-side reading of the bound account at one pinned block (D-202 l.640, l.646, usage l.502). */
export type SetupState = {
  readonly isAuthorized: boolean;
  readonly hasSetup: boolean;
  readonly setupCommitment: Hex;
  readonly setupNonce: bigint;
  /** The block of the last setup write, a clear among them. */
  readonly setupCommittedAtBlock: number;
  readonly attemptActive: boolean;
  readonly block: BlockHeader;
};
