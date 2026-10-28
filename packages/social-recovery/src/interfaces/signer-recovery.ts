import type { Address, RawTransaction } from './records';

/** The integrator's reading of who signed a transaction for an account, in the account's own signature formats. */
export interface ISignerRecovery {
  /** The key that authorised the transaction for the account; `undefined` where the integrator cannot tell. */
  recoverSigner(transaction: RawTransaction, account: Address): Promise<Address | undefined>;
}
