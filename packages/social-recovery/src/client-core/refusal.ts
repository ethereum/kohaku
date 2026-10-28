import type { RestoreCause, ValidationResult } from '../interfaces';
import type { KitRefusalDetails } from '../types';

/** What a client member throws when it refuses; a member absent from the details is absent from the error. */
export class KitRefusalError extends Error {
  declare readonly findings?: ValidationResult;
  declare readonly restoreCause?: RestoreCause;

  constructor(message: string, details?: KitRefusalDetails) {
    super(message);
    this.name = 'KitRefusalError';

    if (details?.findings !== undefined) this.findings = details.findings;

    if (details?.restoreCause !== undefined) this.restoreCause = details.restoreCause;
  }
}
