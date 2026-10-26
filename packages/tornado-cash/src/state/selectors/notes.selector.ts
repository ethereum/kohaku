import { createSelector } from '@reduxjs/toolkit';

import { TCNote } from '../../plugin/interfaces/protocol-params.interface';
import { myDepositsBalanceSelector } from './balance.selector';
import { activePoolsSelector } from './slices.selectors';

/**
 * Returns all notes for the account.
 */
export const allNotesSelector = createSelector(
  [myDepositsBalanceSelector, activePoolsSelector],
  (depositsMap, pools): TCNote[] =>
    Array.from(depositsMap.values()).map((deposit) => ({
      commitment: deposit.commitment,
      assetAddress: deposit.assetAddress,
      balance: deposit.balance,
      amount: pools.get(deposit.pool)!.denomination,
      timestamp: deposit.timestamp,
      leafIndex: deposit.leafIndex,
      depositIndex: deposit.index,
      ...(deposit.nonce !== undefined ? { nonce: deposit.nonce } : {}),
      pool: deposit.pool,
    })),
);
