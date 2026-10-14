import type { IRecoveryMethod } from '../interfaces';
import type { ZkPassportStack } from '../types';
import { installedStack } from './stack';
import { ZkPassportMethod } from './zkpassport-method';

/**
 * The zkPassport recovery method.
 * `stack` replaces `new ZKPassport(domain)`; by default the installed `@zkpassport/sdk` is imported on first use.
 */
export const zkPassportMethod = (stack: ZkPassportStack = installedStack): IRecoveryMethod =>
  new ZkPassportMethod(stack);
