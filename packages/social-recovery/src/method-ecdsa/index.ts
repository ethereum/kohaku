import type { IRecoveryMethod } from '../interfaces';
import { WalletMethod } from './wallet-method';

/** Creates the `method-ecdsa` method, where a guardian approves with their own wallet's signature. */
export const walletMethod = (): IRecoveryMethod => new WalletMethod();
