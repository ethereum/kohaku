import type { Hex } from '../interfaces';

/** How one `eth_call` to a module ended. */
export type CallOutcome =
  /** The contract returned these bytes, lower-cased. */
  | { readonly kind: 'returned'; readonly data: Hex }
  /** The contract reverted. */
  | { readonly kind: 'reverted' }
  /** The provider failed, so the contract was never heard. */
  | { readonly kind: 'failed' };
