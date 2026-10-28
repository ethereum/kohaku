import { BACKUP_PADDING_SIZE, FORMATS_SAFE_INTEGER_BITS, VALIDATION_TIMESTAMP_MAX } from '../constants';
import { serializedConfigurationSize } from '../encryption/serialize';
import { assertObject, assertUintNumber, normalizeAddress } from '../formats/guards';
import type { SetupDraft } from '../interfaces';
import type { Findings, PlacedCredential, SetupValidationContext } from '../types/validation';
import { addError, addWarning } from './common';

/** The wait's findings against the field width over the pinned block's time and the client's maximum and short wait. */
export function waitFindings(draft: SetupDraft, context: SetupValidationContext, findings: Findings): void {
  assertObject(context.block, 'context.block');
  assertUintNumber(context.block.timestamp, FORMATS_SAFE_INTEGER_BITS, 'context.block.timestamp');

  const { wait } = draft;
  const { maxWait, shortWait } = context.configuration;
  const available = VALIDATION_TIMESTAMP_MAX - context.block.timestamp;

  if (wait > available) addError(findings, 'wait.field-width', 'setup', { wait, available });

  if (wait > maxWait) addError(findings, 'wait.above-maximum', 'setup', { wait, maxWait });

  if (wait === 0) addWarning(findings, 'setup.wait-zero', 'setup', { wait, spendableInOpeningBlock: true });
  else if (wait < shortWait) addWarning(findings, 'setup.wait-short', 'setup', { wait, shortWait, alertingOperated: false });
}

/** The backup choice's findings: an encrypted plaintext past the padding size, a clear form, or no backup at all. */
export function backupFindings(
  draft: SetupDraft,
  credentials: readonly PlacedCredential[],
  context: SetupValidationContext,
  findings: Findings,
): void {
  const { backup } = draft.privacy;
  const suppliedSaltPlaces = credentials.filter((credential) => credential.salt !== undefined).map(({ place }) => place);

  if (backup === 'encrypted') {
    const size = serializedConfigurationSize(draft);

    if (size > BACKUP_PADDING_SIZE) {
      addError(findings, 'backup.too-wide', 'setup', { plaintextSize: size, paddingSize: BACKUP_PADDING_SIZE });
    }
  }

  if (backup === 'clear') addWarning(findings, 'backup.clear', 'setup', { revocable: false, suppliedSaltPlaces });

  if (backup === 'empty') {
    const memorable = normalizeAddress(context.descriptor.methodEcdsa, 'context.descriptor.methodEcdsa');
    const unreproduciblePlaces = credentials.filter(({ method }) => method !== memorable).map(({ place }) => place);

    if (unreproduciblePlaces.length > 0 || suppliedSaltPlaces.length > 0) {
      addWarning(findings, 'backup.empty', 'setup', { unreproduciblePlaces, suppliedSaltPlaces });
    }
  }
}
