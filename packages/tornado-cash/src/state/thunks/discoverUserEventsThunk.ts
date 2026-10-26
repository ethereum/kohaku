import { createAsyncThunk } from '@reduxjs/toolkit';
import { ISecretManager } from '../../account/keys';
import { RootState } from '../store';
import { activePoolsSelector, depositsSelector, derivedUserSecretsSelector, instanceRegistryInfoSelector } from '../selectors/slices.selectors';
import { addSignatureSecret } from '../slices/signatureSecretsSlice';
import { addUserSecret } from '../slices/userSecretsSlice';

/** Consecutive signature nonces with no deposit in any pool before the scan stops. */
export const SIGNATURE_GAP_LIMIT = 20;

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
    const pools = activePoolsSelector(state);
    const { chainId } = instanceRegistryInfoSelector(state);
    const userSecrets = derivedUserSecretsSelector(state);
    const poolAddresses = [...pools.keys()];

    let misses = 0;

    for (let nonce = 0; ; nonce++) {
      if (misses >= SIGNATURE_GAP_LIMIT) break;

      misses += 1;

      for (const poolAddress of poolAddresses) {
        const secret = await secretManager.getSignatureSecrets({ poolAddress, chainId, nonce });

        if (!deposits.get(poolAddress)?.has(secret.commitment)) continue;

        misses = 0;
        dispatch(addSignatureSecret({
          poolAddress,
          record: {
            commitment: secret.commitment,
            nullifierHash: secret.nullifierHash,
            nullifier: secret.nullifier,
            salt: secret.salt,
            nonce,
          },
        }));
      }
    }

    for (const poolAddress of poolAddresses) {
      const startIndex = userSecrets.get(poolAddress)?.length ?? 0;
      const poolDeposits = deposits.get(poolAddress);

      for (let depositIndex = startIndex; ; depositIndex++) {
        const secret = await secretManager.getLegacyDepositSecrets({
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
