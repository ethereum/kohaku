import { createAsyncThunk } from '@reduxjs/toolkit';
import { TxData } from '@kohaku-eth/provider';
import { ISecretManager } from '../../account/keys';
import { prepareErc20Shield, prepareNativeShield } from '../../account/tx/shield';
import { Address } from '../../interfaces/types.interface';
import { addressToHex } from '../../utils';
import { RootState } from '../store';
import { instanceRegistryInfoSelector, poolsSelector, userSecretsSelector } from '../selectors/slices.selectors';

export interface GetDepositPayloadThunkParams {
  secretManager: ISecretManager;
  asset: Address;
  amount: bigint;
}

export const getDepositPayloadThunk = createAsyncThunk<
  TxData[],
  GetDepositPayloadThunkParams,
  { state: RootState }
>(
  'deposits/getPayload',
  async ({ secretManager, asset, amount }, { getState }) => {
    const state = getState();
    const pools = poolsSelector(state);
    const { chainId } = instanceRegistryInfoSelector(state);
    const userSecrets = userSecretsSelector(state);

    // Pick the pool with the lowest denomination for the requested asset
    const pool = Array.from(pools.values())
      .filter((p) => p.asset === asset)
      .sort((a, b) => Number(a.denomination - b.denomination))[0];

    if (!pool) throw new Error(`Pool for asset ${addressToHex(asset)} not found`);

    const startIndex = userSecrets.get(pool.address)?.length ?? 0;
    const count = Number(amount / pool.denomination);

    const secrets = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        secretManager.getDepositSecrets({
          chainId,
          depositIndex: startIndex + i,
          poolAddress: pool.address,
        }),
      ),
    );

    const poolAddressHex = addressToHex(pool.address);

    if (!pool.isERC20) {
      return secrets.map(({ commitment }) =>
        prepareNativeShield({
          commitment,
          poolAddress: poolAddressHex,
          poolDenomination: pool.denomination,
        }),
      );
    }

    const assetHex = addressToHex(pool.asset);

    return secrets.flatMap(({ commitment }) =>
      prepareErc20Shield({
        commitment,
        tokenAddress: assetHex,
        poolAddress: poolAddressHex,
        denomination: pool.denomination,
      }),
    );
  },
);
