import { bytesToHex } from 'viem';
import { BACKUP_NONCE_SIZE, BACKUP_PADDING_SIZE, BACKUP_PAYLOAD_VERSION, FORMATS_SETUP_NONCE_BITS } from '../constants';
import { configurationBody, simulatePrepared } from '../client-core';
import { sealBackup, serializeConfiguration } from '../encryption';
import { encodeSetupBody, setupCommitment } from '../formats';
import { assertObject, assertUintBigint } from '../formats/guards';
import type { Configuration, Hex, PreparedBatch, PreparedCall, PrepareOptions, SetupDraft } from '../interfaces';
import type { SetupClientParts } from '../types/setup-client';
import { assertBackupFits, assertBackupPassword, assertOptions } from './check';
import { checkedDraft, draftConfiguration, publicMetadataOf } from './draft';
import { authorizedAt, pinRead } from './reads';

/** A fresh random AES-GCM nonce, drawn for every seal. */
function freshNonce(): Hex {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;

  if (crypto?.getRandomValues === undefined) throw new Error('WebCrypto is unavailable: globalThis.crypto.getRandomValues is missing');

  return bytesToHex(crypto.getRandomValues(new Uint8Array(BACKUP_NONCE_SIZE)));
}

/** The private metadata the draft's backup choice names: sealed under the password, the configuration's bytes, or none. */
async function backupBytes(
  parts: SetupClientParts,
  draft: SetupDraft,
  configuration: Configuration,
  password: string | undefined,
  setupCommitment: Hex,
  nonce: bigint,
): Promise<Hex> {
  if (draft.privacy.backup === 'empty') return '0x';

  if (draft.privacy.backup === 'clear') return serializeConfiguration(configuration);

  return await sealBackup(configuration, password as string, freshNonce(), BACKUP_PADDING_SIZE, {
    account: parts.account,
    action: parts.action,
    setupCommitment,
    nonce,
    payloadVersion: BACKUP_PAYLOAD_VERSION,
  });
}

/**
 * The commit of the draft at one pinned block: the arming write and the commit as one atomic batch while the action is not
 * authorized, the commit alone once it is, simulated unless the options or the configuration say otherwise.
 * It runs no setup validation: the integrator calls `validateSetup` on the draft first. Before any read it refuses with a
 * `RangeError` a body past its ABI widths, and with a `KitRefusalError` carrying `backup.too-wide` an encrypted backup too
 * wide to seal.
 */
export async function prepareCommit(
  parts: SetupClientParts,
  draft: SetupDraft,
  password: string | undefined,
  options: PrepareOptions | undefined,
): Promise<PreparedCall | PreparedBatch> {
  const credentials = checkedDraft(draft);

  assertBackupPassword(draft, password);
  assertOptions(options);

  const configuration = draftConfiguration(draft, credentials);
  const body = configurationBody(configuration, parts.account);
  const encodedBody = encodeSetupBody(body);

  assertBackupFits(draft, configuration);

  const { block } = await pinRead(parts);
  const [state, authorized] = await Promise.all([parts.policyManager.stateOf(block), authorizedAt(parts, block)]);

  assertObject(state, 'state');
  assertUintBigint(state.setupNonce, FORMATS_SETUP_NONCE_BITS, 'state.setupNonce');

  const nonce = state.setupNonce + 1n;

  assertUintBigint(nonce, FORMATS_SETUP_NONCE_BITS, 'the next setup nonce');
  const commitment = setupCommitment(parts.account, parts.action, nonce, encodedBody);
  const privateMetadata = await backupBytes(parts, draft, configuration, password, commitment, nonce);
  const arming = authorized ? undefined : await parts.recoveryAction.armingCall(block);
  const commit = await parts.policyManager.prepareCommitSetup(
    parts.action,
    commitment,
    nonce,
    publicMetadataOf(draft),
    privateMetadata,
    block,
  );
  const prepared: PreparedCall | PreparedBatch =
    arming === undefined ? commit : { kind: 'batch', calls: [arming, commit], atomic: true, block };

  return await simulatePrepared(parts.provider, prepared, parts.account, parts.configuration, options);
}
