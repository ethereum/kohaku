// The three restore causes of D-205 as one record per code, each carrying the
// values its row of the restore table names (D-202 l.660, D-205 l.1086-1092).
// Line numbers are design/offchain/sdk.md.
import type { Address, Hex } from './chain';
import type { RestoreCauseCode } from './findings';

/** Which of the two `restore.no-backup` cases fired: no setup stands, or a standing setup kept no backup (l.660, l.1090). */
export const NO_BACKUP_CASES = ['no-setup', 'no-backup-kept'] as const;

export type NoBackupCase = (typeof NO_BACKUP_CASES)[number];

/** The five values the backup opening authenticates under as associated data (D-202 l.654, D-204 l.932). */
export type BackupAuthenticated = {
  readonly account: Address;
  readonly action: Address;
  readonly setupCommitment: Hex;
  readonly nonce: bigint;
  readonly payloadVersion: number;
};

/** Nothing on chain to open (l.1090). */
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

/** The payload did not open under the five; a wrong password and damaged bytes are one cause (l.1091). */
export type RestoreBackupUnopened = {
  readonly code: Extract<RestoreCauseCode, 'restore.backup-unopened'>;
  readonly subject: 'restore';
  readonly values: {
    /** The payload's size in bytes. */
    readonly payloadSize: number;
    readonly authenticated: BackupAuthenticated;
  };
};

/** What opened does not recompute to the commitment the manager holds (l.1092). */
export type RestoreCommitmentMismatch = {
  readonly code: Extract<RestoreCauseCode, 'restore.commitment-mismatch'>;
  readonly subject: 'restore';
  readonly values: {
    readonly recomputed: Hex;
    readonly committed: Hex;
  };
};

/** The cause the value `getSetup` and the two inits throw carries, discriminated by `code` (D-202 l.660, D-205 l.1086). */
export type RestoreCause = RestoreNoBackup | RestoreBackupUnopened | RestoreCommitmentMismatch;
