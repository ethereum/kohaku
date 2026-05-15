import { createAsyncThunk } from '@reduxjs/toolkit';
import { TxData } from '@kohaku-eth/provider';
import { ISecretManager } from '../../account/keys';
import { prepareErc20Shield, prepareNativeShield } from '../../account/tx/shield';
import { Address } from '../../interfaces/types.interface';
import { addressToHex } from '../../utils';
import { RootState } from '../store';
import { instanceRegistryInfoSelector, poolsSelector, userSecretsSelector } from '../selectors/slices.selectors';
import { IPool } from '../../data/interfaces/events.interface';

export enum DepositStrategy {
  MaxAnonimitySet,
  MinFee
}

export interface GetDepositPayloadThunkParams {
  secretManager: ISecretManager;
  asset: Address;
  amount: bigint;
  strategy: DepositStrategy;
}

interface PoolWithDeposits extends IPool {
  depositsCount: number;
}

const calculatePoolsDeposits = (pools: IPool[], value: bigint, strategy: DepositStrategy): PoolWithDeposits[] => {
  if (!pools.length) {
    throw new Error('No pools to deposit into');
  }

  const poolsToDepositInto: PoolWithDeposits[] = [];

  switch (strategy) {
    case DepositStrategy.MaxAnonimitySet: {
      const lowToHighDenominationPools = pools.sort((a, b) => Number(a.denomination - b.denomination));
      const lowestDenominationPool = lowToHighDenominationPools[0]!;
      
      const depositsCount = Number(value / lowestDenominationPool.denomination);

      poolsToDepositInto.push({
        ...lowestDenominationPool,
        depositsCount,
      });
      break;
    }
    case DepositStrategy.MinFee: {
      const highToLowDenominationPools = pools.sort((a, b) => Number(b.denomination - a.denomination));

      highToLowDenominationPools.reduce((remainingAmount, pool) => {
        const depositsForThisPool = remainingAmount / pool.denomination;

        if (depositsForThisPool > 0n) {
          poolsToDepositInto.push({
            ...pool,
            depositsCount: Number(depositsForThisPool)
          })
        }

        return remainingAmount - (depositsForThisPool * pool.denomination);
      }, value);
      break;
    }
  }

  return poolsToDepositInto;
}

export const getDepositPayloadThunk = createAsyncThunk<
  TxData[],
  GetDepositPayloadThunkParams,
  { state: RootState }
>(
  'deposits/getPayload',
  async ({ secretManager, asset, amount, strategy }, { getState }) => {
    const state = getState();
    const pools = poolsSelector(state);
    const { chainId } = instanceRegistryInfoSelector(state);
    const userSecrets = userSecretsSelector(state);

    // Pick the pool with the lowest denomination for the requested asset
    const poolsCandidates = Array.from(pools.values())
      .filter((p) => p.asset === asset);
    
    if (poolsCandidates.length === 0) throw new Error(`No pools available for asset ${addressToHex(asset)}`);

    const poolsToDepositInto = calculatePoolsDeposits(poolsCandidates, amount, strategy);
    
    const depositInfo = await Promise.all(poolsToDepositInto.map(async (pool) => {
      const startIndex = userSecrets.get(pool.address)?.length ?? 0;
      const count = pool.depositsCount;

      const secrets = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          secretManager.getDepositSecrets({
            chainId,
            depositIndex: startIndex + i,
            poolAddress: pool.address,
          }),
        ),
      );

      return {
        ...pool,
        secrets,
      }
    }));

    const newDeposits = depositInfo.reduce((txData, {secrets, ...pool}) => {
      const poolAddressHex = addressToHex(pool.address);
  
      if (!pool.isERC20) {
        const newDeposits = secrets.map(({ commitment }) =>
          prepareNativeShield({
            commitment,
            poolAddress: poolAddressHex,
            poolDenomination: pool.denomination,
          }),
        );

        return txData.concat(newDeposits);
      }

      const assetHex = addressToHex(pool.asset);
  
      const newDeposits = secrets.flatMap(({ commitment }) =>
        prepareErc20Shield({
          commitment,
          tokenAddress: assetHex,
          poolAddress: poolAddressHex,
          denomination: pool.denomination,
        }),
      );

      return txData.concat(newDeposits)
    }, [] as TxData[])

    return newDeposits;
  },
);
