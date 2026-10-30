import {
  BACKUP_PAYLOAD_VERSION,
  CLIENT_CORE_BACKUP_UNOPENED_MESSAGE,
  CLIENT_CORE_COMMITMENT_MISMATCH_MESSAGE,
  CLIENT_CORE_NO_BACKUP_MESSAGE,
  CLIENT_CORE_NO_SETUP_COMMITMENT,
  FORMATS_SAFE_INTEGER_BITS,
  FORMATS_SETUP_NONCE_BITS,
} from '../constants';
import { BackupUnopenedError, openBackup } from '../encryption';
import { assertPassword } from '../encryption/cipher';
import { assertBytes32, assertObject, assertUintBigint, assertUintNumber, checkedBlock, lowerHex, normalizeAddress } from '../formats/guards';
import type {
  ActionState,
  Address,
  BackupAuthenticated,
  Configuration,
  ConfigurationSource,
  Hex,
  IEventManager,
  KitNotification,
  PinnedBlock,
} from '../interfaces';
import type { SetupCommitted } from '../types/client-core';
import { configurationCommitment } from './body';
import { KitRefusalError } from './refusal';

/** Whether a commitment already checked as 32 bytes is a standing setup's, not the zero word. */
const standingCommitment = (commitment: Hex): boolean => commitment.toLowerCase() !== CLIENT_CORE_NO_SETUP_COMMITMENT;

/** Refuses a state that is not an object or whose commitment is not 32 bytes. */
function assertStateCommitment(state: ActionState): void {
  assertObject(state, 'state');
  assertBytes32(state.setupCommitment, 'state.setupCommitment');
}

/** Whether a setup stands: the manager's commitment is not the zero word. */
export function setupStands(state: ActionState): boolean {
  assertStateCommitment(state);

  return standingCommitment(state.setupCommitment);
}

/** Refuses a malformed state member the restore reads, before any read. */
function assertRestoreState(state: ActionState): void {
  assertStateCommitment(state);
  assertUintBigint(state.setupNonce, FORMATS_SETUP_NONCE_BITS, 'state.setupNonce');
  assertUintNumber(state.setupCommittedAtBlock, FORMATS_SAFE_INTEGER_BITS, 'state.setupCommittedAtBlock');
}

/** The refusal naming no backup, in one of its two cases. */
const noBackup = (account: Address, action: Address, nonce?: bigint): KitRefusalError =>
  new KitRefusalError(CLIENT_CORE_NO_BACKUP_MESSAGE, {
    restoreCause: {
      code: 'restore.no-backup',
      subject: 'restore',
      values:
        nonce === undefined ? { account, action, case: 'no-setup' } : { account, action, case: 'no-backup-kept', nonce },
    },
  });

/** The live setup-committed event with the highest nonce, the later in log order on a tie. */
function latestCommitted(notifications: readonly KitNotification[]): SetupCommitted | undefined {
  let latest: SetupCommitted | undefined;

  for (const notification of notifications) {
    if (notification.kind !== 'setup-committed' || notification.at.removed) continue;

    if (latest === undefined || notification.nonce >= latest.nonce) latest = notification;
  }

  return latest;
}

/** Fetches the current setup's backup and opens it under the password and the setup it is bound to. */
async function openCurrentBackup(
  events: IEventManager,
  password: string,
  authenticated: BackupAuthenticated,
  from: number,
  block: PinnedBlock,
): Promise<Configuration> {
  const { account, action, setupCommitment, nonce } = authenticated;
  const notifications = await events.fetch(events.accountFilter(), { from, to: block.number });
  const latest = latestCommitted(notifications);

  if (
    latest === undefined ||
    latest.nonce !== nonce ||
    latest.setupCommitment.toLowerCase() !== setupCommitment ||
    latest.privateMetadata === '0x'
  ) {
    throw noBackup(account, action, nonce);
  }

  try {
    return await openBackup(latest.privateMetadata, password, authenticated);
  } catch (thrown) {
    if (!(thrown instanceof BackupUnopenedError)) throw thrown;

    throw new KitRefusalError(CLIENT_CORE_BACKUP_UNOPENED_MESSAGE, {
      restoreCause: {
        code: 'restore.backup-unopened',
        subject: 'restore',
        values: { payloadSize: thrown.payloadSize, authenticated },
      },
    });
  }
}

/**
 * The setup standing for the account and action at the caller's block and `stateOf` reading, from the source given.
 * A password source opens the current setup's encrypted backup; a configuration source is checked and returned as given.
 * A clear or empty backup never opens under a password, so its holder passes the configuration itself as the source.
 * Refuses with a `KitRefusalError` carrying the restore cause; a failed read rejects as the read rejected.
 */
export async function restoreConfiguration(
  events: IEventManager,
  account: Address,
  action: Address,
  source: ConfigurationSource,
  state: ActionState,
  block: PinnedBlock,
): Promise<Configuration> {
  const pinned = checkedBlock(block, 'block');
  const accountAddress = normalizeAddress(account, 'account');
  const actionAddress = normalizeAddress(action, 'action');

  assertRestoreState(state);
  assertObject(source, 'source');

  if ('password' in source) assertPassword(source.password);

  if (!standingCommitment(state.setupCommitment)) throw noBackup(accountAddress, actionAddress);

  const committed: Hex = lowerHex(state.setupCommitment);
  const configuration =
    !('password' in source)
      ? source
      : await openCurrentBackup(
          events,
          source.password,
          {
            account: accountAddress,
            action: actionAddress,
            setupCommitment: committed,
            nonce: state.setupNonce,
            payloadVersion: BACKUP_PAYLOAD_VERSION,
          },
          state.setupCommittedAtBlock,
          pinned,
        );
  const recomputed = configurationCommitment(configuration, accountAddress, actionAddress, state.setupNonce);

  if (recomputed !== committed) {
    throw new KitRefusalError(CLIENT_CORE_COMMITMENT_MISMATCH_MESSAGE, {
      restoreCause: { code: 'restore.commitment-mismatch', subject: 'restore', values: { recomputed, committed } },
    });
  }

  return configuration;
}
