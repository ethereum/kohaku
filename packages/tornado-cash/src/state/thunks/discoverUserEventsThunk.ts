import { createAsyncThunk } from '@reduxjs/toolkit';
import { ISecretManager } from '../../account/keys';
import { RootState } from '../store';
import { depositsSelector, instanceRegistryInfoSelector, poolsSelector, userSecretsSelector } from '../selectors/slices.selectors';
import { addUserSecret } from '../slices/userSecretsSlice';

export interface DiscoverUserEventsThunkParams {
  secretManager: ISecretManager;
}

export const discoverUserEventsThunk = createAsyncThunk<
  void,
  DiscoverUserEventsThunkParams,
  { state: RootState }
>(
  'userSecrets/discover',
  async ({ secretManager }, { getState, dispatch }) => {
    const state = getState();
    const deposits = depositsSelector(state);
    const pools = poolsSelector(state);
    const { chainId } = instanceRegistryInfoSelector(state);
    const userSecrets = userSecretsSelector(state);

    for (const [poolAddress] of pools) {
      const startIndex = userSecrets.get(poolAddress)?.length ?? 0;
      const poolDeposits = deposits.get(poolAddress);

      for (let depositIndex = startIndex; ; depositIndex++) {
        const secret = await secretManager.getDepositSecrets({
          poolAddress,
          chainId,
          depositIndex,
        });

        if (!poolDeposits?.has(secret.commitment)) break;

        dispatch(addUserSecret({
          poolAddress,
          record: {
            commitment: secret.commitment,
            nullifierHash: secret.nullifierHash,
            nullifier: secret.nullifier,
            salt: secret.salt,
            depositIndex,
          },
        }));
      }
    }
  },
);
