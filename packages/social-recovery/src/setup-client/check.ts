import {
  BACKUP_PADDING_SIZE,
  SETUP_CLIENT_BACKUP_TOO_WIDE_MESSAGE,
  SETUP_CLIENT_PASSWORD_MISSING_MESSAGE,
  SETUP_CLIENT_PASSWORD_UNUSED_MESSAGE,
  SETUP_CLIENT_VERSION_ESCAPED_MESSAGE,
} from '../constants';
import { checkedDescriptorOrigin } from '../builder/origin';
import { KitRefusalError } from '../client-core';
import { assertPassword } from '../encryption/cipher';
import { serializedConfigurationSize } from '../encryption/serialize';
import { assertArray, assertBool, assertDependency, assertObject, normalizeAddress, sameAddress } from '../formats/guards';
import { checkedConfiguration, checkedDescriptor } from '../formats/records';
import { type Address, type Configuration, type IActionCodec, type PrepareOptions, type SetupDraft } from '../interfaces';
import type { SetupClientParts } from '../types/setup-client';
import { addError, emptyFindings } from '../validation/common';

/** Refuses a codec that is not one or does not serve the action. */
function assertServes(codec: IActionCodec, action: Address): void {
  assertDependency(codec, ['decode'], 'codec');
  assertArray(codec.actions, 'codec.actions');

  const served = codec.actions.map((entry, index) => normalizeAddress(entry, `codec.actions[${index}]`));

  if (!served.some((entry) => sameAddress(entry, action))) throw new RangeError(`action ${action} is not one the codec serves`);
}

/**
 * The client's inputs with the account, the action and the records' addresses checksummed and the descriptor's origin derived,
 * refusing a malformed part or record, and a codec that does not serve the action.
 */
export function checkedParts(parts: Omit<SetupClientParts, 'descriptorOrigin'>): SetupClientParts {
  const { provider, descriptor, configuration, policyManager, recoveryAction, events, methods, codec } = parts;

  assertDependency(provider, ['block', 'call', 'code', 'transaction'], 'provider');

  const checkedRecords = { descriptor: checkedDescriptor(descriptor, 'descriptor'), configuration: checkedConfiguration(configuration, 'configuration') };

  assertDependency(policyManager, ['prepareCommitSetup', 'prepareClearSetup', 'stateOf', 'moduleInfo', 'paused', 'trustedParties'], 'policyManager');
  assertDependency(
    recoveryAction,
    ['supportsAccount', 'isAuthority', 'isAuthorized', 'actionInfo', 'disarmingCall', 'armingCall'],
    'recoveryAction',
  );
  assertDependency(events, ['accountFilter', 'fetch'], 'events');
  assertDependency(methods, ['get', 'keys'], 'methods');

  if (parts.signerRecovery !== undefined) assertDependency(parts.signerRecovery, ['recoverSigner'], 'signerRecovery');

  const account = normalizeAddress(parts.account, 'account');
  const action = normalizeAddress(parts.action, 'action');

  assertServes(codec, action);

  return { ...parts, ...checkedRecords, descriptorOrigin: checkedDescriptorOrigin(checkedRecords.descriptor), account, action };
}

/** Refuses options that are not an object, whose `simulate` is present and not a boolean, or whose `from` is present and not an address. */
export function assertOptions(options: PrepareOptions | undefined): void {
  if (options === undefined) return;

  assertObject(options, 'options');

  if (options.simulate !== undefined) assertBool(options.simulate, 'options.simulate');

  if (options.from !== undefined) normalizeAddress(options.from, 'options.from');
}

/** Refuses every prepare of a client built for a deployment version this build does not serve. */
export function assertPreparesServed(versionEscaped: boolean): void {
  if (versionEscaped) throw new KitRefusalError(SETUP_CLIENT_VERSION_ESCAPED_MESSAGE);
}

/** Refuses with a `TypeError` an encrypted backup without a password, a password beside a clear or empty backup, and a malformed password. */
export function assertBackupPassword(draft: SetupDraft, password: string | undefined): void {
  if (password !== undefined) assertPassword(password);

  const encrypted = draft.privacy.backup === 'encrypted';

  if (encrypted && password === undefined) throw new TypeError(SETUP_CLIENT_PASSWORD_MISSING_MESSAGE);

  if (!encrypted && password !== undefined) throw new TypeError(SETUP_CLIENT_PASSWORD_UNUSED_MESSAGE);
}

/**
 * Refuses with a `KitRefusalError` carrying one `backup.too-wide` finding an encrypted backup whose serialized configuration
 * is longer than the padding it is sealed in, so the commit reads nothing for a backup it could not seal.
 */
export function assertBackupFits(draft: SetupDraft, configuration: Configuration): void {
  if (draft.privacy.backup !== 'encrypted') return;

  const plaintextSize = serializedConfigurationSize(configuration);

  if (plaintextSize <= BACKUP_PADDING_SIZE) return;

  const findings = emptyFindings();

  addError(findings, 'backup.too-wide', 'setup', { plaintextSize, paddingSize: BACKUP_PADDING_SIZE });

  throw new KitRefusalError(SETUP_CLIENT_BACKUP_TOO_WIDE_MESSAGE, { findings });
}
