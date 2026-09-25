import { BACKUP_UNOPENED_MESSAGE } from '../constants';

/** The payload did not open under the password and the authenticated values, whatever the cause. */
export class BackupUnopenedError extends Error {
  readonly payloadSize: number;

  constructor(payloadSize: number, message = BACKUP_UNOPENED_MESSAGE) {
    super(message);
    this.name = 'BackupUnopenedError';
    this.payloadSize = payloadSize;
  }
}

/** The configuration's serialization is longer than the padding size, so it cannot be sealed. */
export class BackupTooWideError extends Error {
  readonly plaintextSize: number;
  readonly paddingSize: number;

  constructor(plaintextSize: number, paddingSize: number) {
    super(`backup plaintext of ${plaintextSize} bytes exceeds the padding size of ${paddingSize} bytes`);
    this.name = 'BackupTooWideError';
    this.plaintextSize = plaintextSize;
    this.paddingSize = paddingSize;
  }
}
