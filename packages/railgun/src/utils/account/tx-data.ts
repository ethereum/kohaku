import type { TxData } from '../../account';

export const getTxData = (
  address: string,
  payload: string,
  value: bigint = 0n,
  gasLimit?: bigint,
): TxData => ({
  to: address,
  data: payload,
  value,
  ...(gasLimit !== undefined && {
    gas: gasLimit,
    gasLimit,
  }),
});
