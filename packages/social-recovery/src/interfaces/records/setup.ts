import type { Address, BlockHeader, Hex, LogPosition } from './chain';

/** One credential: a method address and a config in that method's layout. */
export type Credential = {
  readonly method: Address;
  readonly config: Hex;
  /** A contact-book label the commitment does not cover. */
  readonly label?: string;
  /** Absent where the default `keccak256(account, place)` applies. */
  readonly salt?: Hex;
};

/** One clause of the rule: a threshold over its credentials. */
export type Clause = {
  readonly threshold: number;
  readonly credentials: readonly Credential[];
};

/** What the setup keeps as a backup. */
export const BACKUP_CHOICES = ['encrypted', 'clear', 'empty'] as const;

export type BackupChoice = (typeof BACKUP_CHOICES)[number];

/** A draft's privacy choices. */
export type DraftPrivacy = {
  /** Published on chain by the commit, so it must hold nothing private. */
  readonly publicMetadata: Hex;
  readonly backup: BackupChoice;
};

/** The arrangement a holder wrote on a screen, before one commit. */
export type SetupDraft = {
  /** In seconds. */
  readonly wait: number;
  readonly clauses: readonly Clause[];
  /** Whether a method's stop reaches this holder's attempts. */
  readonly ignoresPause: boolean;
  readonly privacy: DraftPrivacy;
};

/** The holder's readable copy of their own setup: what the commitment closes over, and not a draft. */
export type Configuration = {
  readonly clauses: readonly Clause[];
  readonly wait: number;
  readonly ignoresPause: boolean;
};

/**
 * A restore's source: the password that opens the backup, or the configuration itself.
 * `'password' in source` tells the two apart.
 */
export type ConfigurationSource = { readonly password: string } | Configuration;

/** What `confirmSetup` yields. */
export type SetupConfirmation = {
  /** Whether the event at the predicted nonce was found with that commitment. */
  readonly landed: boolean;
  readonly nonce: bigint;
  readonly setupCommitment: Hex;
  readonly isAuthorized: boolean;
  /** The event's log position, where one was found. */
  readonly position?: LogPosition;
};

/** The setup-side reading of the bound account at one pinned block. */
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
