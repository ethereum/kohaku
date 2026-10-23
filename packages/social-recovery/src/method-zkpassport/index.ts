import { METHOD_ZKPASSPORT_DEFAULT_DEV_MODE } from '../constants';
import type { IRecoveryMethod } from '../interfaces';
import type { ZkPassportMethodOptions } from '../types';
import { installedStack } from './stack';
import { ZkPassportMethod } from './zkpassport-method';

export type { ZkPassportMethodOptions } from '../types';

/**
 * The zkPassport recovery method.
 * `stack` replaces `new ZKPassport(domain)`; by default the installed `@zkpassport/sdk` is imported on first use.
 * `devMode` opens dev-mode requests and accepts the app's fake-passport proofs locally; the deployed module verifies
 * with dev mode off and refuses any nullifier type but zero, so such a reply is rejected on chain.
 */
export const zkPassportMethod = (options: ZkPassportMethodOptions = {}): IRecoveryMethod =>
  new ZkPassportMethod(options.stack ?? installedStack, options.devMode ?? METHOD_ZKPASSPORT_DEFAULT_DEV_MODE);
