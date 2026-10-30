import type { IRecoveryMethod } from '../interfaces';
import { PasskeyMethod } from './passkey-method';

/** Creates the passkey recovery method. */
export const passkeyMethod = (): IRecoveryMethod => new PasskeyMethod();
