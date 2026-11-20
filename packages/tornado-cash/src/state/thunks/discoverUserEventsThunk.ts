import { createAsyncThunk } from '@reduxjs/toolkit';
import { ISecretManager } from '../../account/keys';
import { RootState } from '../store';
import { activePoolsSelector, depositsSelector, derivedUserSecretsSelector, instanceRegistryInfoSelector, signatureNextNonceSelector } from '../selectors/slices.selectors';
import { addSignatureSecret } from '../slices/signatureSecretsSlice';
import { addUserSecret } from '../slices/userSecretsSlice';

/** Consecutive signature nonces with no deposit in any pool before the scan stops. */
export const SIGNATURE_GAP_LIMIT = 20;
/** Largest gap limit a caller may ask for; each nonce costs a signature and a hash per pool. */
export const MAX_SIGNATURE_GAP_LIMIT = 10_000;

export const assertSignatureGapLimit = (gapLimit: number): void => {
  if (!Number.isSafeInteger(gapLimit) || gapLimit < SIGNATURE_GAP_LIMIT || gapLimit > MAX_SIGNATURE_GAP_LIMIT) {
    throw new Error(`signatureGapLimit must be an integer from ${SIGNATURE_GAP_LIMIT} to ${MAX_SIGNATURE_GAP_LIMIT}`);
  }
};

export interface DiscoverUserEventsThunkParams {
  secretManager: ISecretManager;
  /** Misses past the last hit before the scan stops. Raise it to recover deposits made from another device. */
  gapLimit?: number;
}

export const discoverUserEventsThunk = createAsyncThunk<
  void,
  DiscoverUserEventsThunkParams,
  { state: RootState }
>(
  'userSecrets/discover',
  async ({ secretManager, gapLimit = SIGNATURE_GAP_LIMIT }, { getState, dispatch }) => {
    assertSignatureGapLimit(gapLimit);

    const state = getState();
    const deposits = depositsSelector(state);
    const pools = activePoolsSelector(state);
    const { chainId } = instanceRegistryInfoSelector(state);
    const userSecrets = derivedUserSecretsSelector(state);
    const poolAddresses = [...pools.keys()];
    // Nonces this account handed out may be mined in any order, so all of them
    // are checked. Past them, the scan still stops `gapLimit` misses after the last hit.
    const reservedNonces = signatureNextNonceSelector(state);

    let misses = 0;

    for (let nonce = 0; nonce < reservedNonces || misses < gapLimit; nonce++) {
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
