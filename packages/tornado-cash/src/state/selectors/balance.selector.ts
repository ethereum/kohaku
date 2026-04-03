import { createSelector } from '@reduxjs/toolkit';

import { IDepositWithAsset, IDepositWithBalance } from '../../data/interfaces/events.interface';
import { Address, Commitment } from '../../interfaces/types.interface';
import { RootState } from '../store';
import { createMyDepositsSelector } from './deposits.selector';
import { assetSelector, poolsSelector } from './slices.selectors';
import { createMyWithdrawalsSelector } from './withdrawals.selector';

export type SpecificAssetBalanceSelectorFn = <
  const Adresses extends Address | Address[] = Address[],
>(state: RootState, assetAddress?: Adresses) => Adresses extends unknown[] ? Map<Address, bigint> : bigint;

export type SpecificAssetBalanceFn<isAsync extends boolean = false> = <
  const Adresses extends Address | Address[] = Address[],
  ReturnType = Adresses extends unknown[] ? Map<Address, bigint> : bigint,
>(assetAddress?: Adresses) => isAsync extends true ? Promise<ReturnType> : ReturnType;

/**
 * Provides a map of every precommitment mapped to a deposit+assetAddress
 *
 */
export const createMyDepositsWithAssetSelector = (
  myDepositsSelector: ReturnType<typeof createMyDepositsSelector>,
) => {
  return createSelector(
    [
      myDepositsSelector,
      poolsSelector,
    ],
    (myDeposits, poolsMap): Map<Commitment, IDepositWithAsset> => {
      const depositsWithAssets = Array.from(myDeposits)
        .map(([commitment, deposit]) => {
          const pool = poolsMap.get(deposit.pool);

          if (!pool) return undefined;

          return [commitment, {
            ...deposit,
            assetAddress: pool.asset,
          }] as const;
        })
        .filter((e) => e !== undefined);

      return new Map(depositsWithAssets)
    }
  );
};

/**
 * Provides a map of every precommitment mapped to a deposit+assetAddress+balance.
 * It takes deposits+asset, withdraws and ragequits and aggregates balance over a 
 * deposit lineage returning lefover balance.
 */
export const createMyDepositsBalanceSelector = ({
  myWithdrawalsSelector,
  myDepositsWithAssetSelector
}: {
  myWithdrawalsSelector: ReturnType<typeof createMyWithdrawalsSelector>,
  myDepositsWithAssetSelector: ReturnType<typeof createMyDepositsWithAssetSelector>,
}) => {

  return createSelector(
    [
      myWithdrawalsSelector,
      myDepositsWithAssetSelector,
      poolsSelector,
    ],
    (withdrawalsMap, myDeposits, pools): Map<Commitment, IDepositWithBalance> => {
      const depositsByCommitment = Array.from(myDeposits.values())
        .map((deposit): [Commitment, IDepositWithBalance] => {
          const withdrawal = withdrawalsMap.get(deposit.commitment);

          return [
            deposit.commitment, 
            {
              ...deposit,
              balance: withdrawal ? 0n : pools.get(deposit.pool)!.denomination,
            }
          ] as const;
        });

      return new Map(depositsByCommitment);
    }
  );
};

export const createMyAssetsBalanceSelector = ({
  myDepositsBalanceSelector,
}: { myDepositsBalanceSelector: ReturnType<typeof createMyDepositsBalanceSelector> }) => {

  return createSelector(
    [myDepositsBalanceSelector],
    (depositsMap): Map<Address, bigint> => {
      const assetsBalanceMap = new Map<Address, bigint>();

      for (const deposit of depositsMap.values()) {
        const currentBalance = assetsBalanceMap.get(deposit.assetAddress) || 0n;

        assetsBalanceMap.set(deposit.assetAddress, currentBalance + deposit.balance);
      }

      return assetsBalanceMap;
    }
  );
};

export const createAllAssetsBalanceSelector = (
  myAssetsBalanceSelector: ReturnType<typeof createMyAssetsBalanceSelector>
) => createSelector([
  myAssetsBalanceSelector,
  assetSelector
], (myAssetsBalance, allAssets) => {
  return new Map(
    Array.from(allAssets)
      .map(([assetAddress]) => [assetAddress, myAssetsBalance.get(assetAddress) || 0n] as const)
  )
})

export const createSpecificAssetBalanceSelector = (
  allAssetsBalanceSelector: ReturnType<typeof createAllAssetsBalanceSelector>
) => {
  return createSelector(
    [
      allAssetsBalanceSelector,
      (_state: RootState, assetAddresses: Address[] | Address = []) => assetAddresses,
    ],
    (assetsBalanceMap, assetAddress) => {
      if (assetAddress instanceof Array) {
        const addresses = assetAddress.length === 0 ? [...assetsBalanceMap.keys()] : assetAddress;

        return new Map(addresses.map((address) => {
          const balance = assetsBalanceMap.get(address) || 0n;

          return [address, balance] as const
        }));
      }

      const balance = assetsBalanceMap.get(assetAddress) || 0n;

      return balance;
    }
  ) as SpecificAssetBalanceSelectorFn;
};
