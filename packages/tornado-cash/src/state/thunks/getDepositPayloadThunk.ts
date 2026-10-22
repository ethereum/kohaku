import { createAsyncThunk } from '@reduxjs/toolkit';
import { TxData } from '@kohaku-eth/provider';
import { ISecretManager } from '../../account/keys';
import { prepareErc20Shield, prepareNativeShield } from '../../account/tx/shield';
import { Address } from '../../interfaces/types.interface';
import { addressToHex } from '../../utils';
import { RootState } from '../store';
import { activePoolsSelector, instanceRegistryInfoSelector, signatureUserSecretsSelector } from '../selectors/slices.selectors';
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

const calculatePoolsDeposits = (
  pools: IPool[],
  value: bigint,
  strategy: DepositStrategy,
): PoolWithDeposits[] => {
  if (!pools.length) {
    throw new Error('No pools to deposit into');
  }

  const poolsToDepositInto: PoolWithDeposits[] = [];

  switch (strategy) {
    case DepositStrategy.MaxAnonimitySet: {
      // Smallest denomination is only a stand-in for the largest anonymity set
      // among the classic pools. The extended denominations start empty, so
      // they stay out of this strategy.
      const classicPools = pools.filter((pool) => !pool.extended);
      const candidates = classicPools.length > 0 ? classicPools : pools;
      const lowToHighDenominationPools = [...candidates].sort((a, b) => Number(a.denomination - b.denomination));
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
    const pools = activePoolsSelector(state);
    const { chainId } = instanceRegistryInfoSelector(state);
    const signatureSecrets = signatureUserSecretsSelector(state);
    let nonce = 0;

    for (const records of signatureSecrets.values()) {
      for (const record of records) {
        if (record.nonce >= nonce) nonce = record.nonce + 1;
      }
    }

    // Pick the pool with the lowest denomination for the requested asset
    const poolsCandidates = Array.from(pools.values())
      .filter((p) => p.asset === asset);
    
    if (poolsCandidates.length === 0) throw new Error(`No pools available for asset ${addressToHex(asset)}`);

    const poolsToDepositInto = calculatePoolsDeposits(poolsCandidates, amount, strategy);
    
    const nonceAssignments = poolsToDepositInto.map((pool) => {
      const startNonce = nonce;

      nonce += pool.depositsCount;

      return { pool, startNonce };
    });

    const depositInfo = await Promise.all(nonceAssignments.map(async ({ pool, startNonce }) => {
      const secrets = await Promise.all(
        Array.from({ length: pool.depositsCount }, (_, i) =>
          secretManager.getSignatureSecrets({
            chainId,
            nonce: startNonce + i,
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
