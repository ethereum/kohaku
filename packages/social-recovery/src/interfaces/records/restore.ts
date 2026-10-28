import type { Address, Hex } from './chain';
import type { RestoreCauseCode } from './findings';

/** Which `restore.no-backup` case fired. */
export const NO_BACKUP_CASES = ['no-setup', 'no-backup-kept'] as const;

export type NoBackupCase = (typeof NO_BACKUP_CASES)[number];

/** The associated data the backup is authenticated under. */
export type BackupAuthenticated = {
  readonly account: Address;
  readonly action: Address;
  readonly setupCommitment: Hex;
  readonly nonce: bigint;
  readonly payloadVersion: number;
};

/** Nothing on chain to open. */
export type RestoreNoBackup = {
  readonly code: Extract<RestoreCauseCode, 'restore.no-backup'>;
  readonly subject: 'restore';
  readonly values: {
    readonly account: Address;
    readonly action: Address;
    readonly case: NoBackupCase;
    /** The nonce of the setup write; present where a setup stands. */
    readonly nonce?: bigint;
  };
};

/** The backup did not open; a wrong password and damaged bytes are one cause. */
export type RestoreBackupUnopened = {
  readonly code: Extract<RestoreCauseCode, 'restore.backup-unopened'>;
  readonly subject: 'restore';
  readonly values: {
    /** The payload's size in bytes. */
    readonly payloadSize: number;
    readonly authenticated: BackupAuthenticated;
  };
};

/** What opened does not recompute to the commitment the manager holds. */
export type RestoreCommitmentMismatch = {
  readonly code: Extract<RestoreCauseCode, 'restore.commitment-mismatch'>;
  readonly subject: 'restore';
  readonly values: {
    readonly recomputed: Hex;
    readonly committed: Hex;
  };
};

/** The cause carried by what `getSetup` and the gathering inits throw. */
export type RestoreCause = RestoreNoBackup | RestoreBackupUnopened | RestoreCommitmentMismatch;
