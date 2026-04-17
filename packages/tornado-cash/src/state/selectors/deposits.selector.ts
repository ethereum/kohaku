import { TxData } from '@kohaku-eth/provider';
import { createSelector } from '@reduxjs/toolkit';

import { ISecretManager } from '../../account/keys';
import { prepareErc20Shield, prepareNativeShield } from '../../account/tx/shield';
import { IIndexedDepositEvent } from '../../data/interfaces/events.interface';
import { Address, Commitment } from '../../interfaces/types.interface';
import { addressToHex } from '../../utils';
import { BaseSelectorParams } from '../interfaces/selectors.interface';
import { RootState } from '../store';
import { depositsSelector, instanceRegistryInfoSelector, poolsSelector } from './slices.selectors';

/**
 * Returns a Map with every deposit we own. We also check approved status.
 */
export const createMyDepositsSelector = ({
  secretManager,
}: Pick<BaseSelectorParams, 'secretManager'>) => {
  return createSelector(
    [
      depositsSelector,
      poolsSelector,
      instanceRegistryInfoSelector,
    ],
    // TODO: do we need the instanceRegistryAddress to calculate secrets?
    (depositsMap, pools, { chainId }): Map<Commitment, IIndexedDepositEvent> => {
      const myDeposits: IIndexedDepositEvent[] = [];

      for (const [poolAddress] of pools) {
        for (let depositIndex = 0; ; depositIndex++) {
          const { commitment } = secretManager.getDepositSecrets({
            poolAddress,
            chainId,
            depositIndex,
          });
  
          const deposit = depositsMap.get(poolAddress)?.get(commitment);

          if (!deposit) {
            break;
          }
  
          myDeposits.push({
            ...deposit,
            index: depositIndex,
          });
        }
      }

      return new Map(myDeposits.map((deposit) => [deposit.commitment, deposit] as const));
    }
  );
};

const filterMyDepositsByPool = (myDeposits: Map<Commitment, IIndexedDepositEvent>, poolAddress: Address) => 
  Array.from(myDeposits.values()).filter((d) => d.pool === poolAddress).length;

export const createGetNextDepositsPayloadSelector = ({
  myDepositsSelector,
  secretsManager,
}: {
  myDepositsSelector: ReturnType<typeof createMyDepositsSelector>;
  secretsManager: ISecretManager
}) => {
  return createSelector(
    [
      myDepositsSelector,
      (_state: RootState, assetAddress: Address) => assetAddress,
      (_state: RootState, _assetAddress: Address, amount: bigint) => amount,
      poolsSelector,
      instanceRegistryInfoSelector
    ],
    (myDeposits, assetAddress, amount, pools, { chainId }): TxData[] => {
      const pool = Array.from(pools.values()).find((p) => p.asset === assetAddress);

      if (!pool) {
        throw new Error('Pool for asset not found');
      }

      const isNative = !pool.isERC20;
      const poolAddressHex = addressToHex(pool.address);

      const poolDepositsCount = filterMyDepositsByPool(myDeposits, pool.address);
      const depositsToGenerate = amount / pool.denomination;

      const newSecretsIndexes = new Array(Number(depositsToGenerate))
        .fill(0).map((_ , index) => poolDepositsCount + index);

      if (isNative) {
        return newSecretsIndexes.map((depositIndex) => {
          const { commitment } = secretsManager.getDepositSecrets({
            chainId,
            depositIndex,
            poolAddress: pool.address
          });

          return prepareNativeShield({
            commitment,
            poolAddress: poolAddressHex,
            poolDenomination: pool.denomination,
          });
        });
      } else {
        const assetHex = addressToHex(pool.asset);

        return newSecretsIndexes.flatMap((depositIndex) => {
          const { commitment } = secretsManager.getDepositSecrets({
            chainId,
            depositIndex,
            poolAddress: pool.address
          });

          return prepareErc20Shield({
            commitment,
            tokenAddress: assetHex,
            poolAddress: poolAddressHex,
            denomination: pool.denomination,
          });
        });
      }
    }
  );
};
