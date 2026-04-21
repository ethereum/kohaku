import { createSelector } from '@reduxjs/toolkit';
import { IIndexedDepositEvent } from '../../data/interfaces/events.interface';
import { Commitment } from '../../interfaces/types.interface';
import { depositsSelector, userSecretsSelector } from './slices.selectors';
import { UserSecretRecord } from '../slices/userSecretsSlice';

/**
 * Returns a Map of every deposit owned by this user, keyed by commitment.
 * Ownership is determined by the userSecrets slice (populated by discoverUserEventsThunk).
 */
export const myDepositsSelector = createSelector(
  [depositsSelector, userSecretsSelector],
  (deposits, userSecrets): Map<Commitment, IIndexedDepositEvent> => {
    const result = new Map<Commitment, IIndexedDepositEvent>();

    for (const [poolKey, records] of Object.entries(userSecrets) as [string, UserSecretRecord[]][]) {
      const poolAddress = BigInt(poolKey) as Commitment;
      const poolDeposits = deposits.get(poolAddress);

      if (!poolDeposits) continue;

      for (const r of records) {
        const commitment = BigInt(r.commitment) as Commitment;
        const deposit = poolDeposits.get(commitment);

        if (deposit) {
          result.set(commitment, { ...deposit, index: r.depositIndex });
        }
      }
    }

    return result;
  },
);

