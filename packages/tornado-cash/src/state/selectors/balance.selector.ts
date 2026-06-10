import { createSelector } from '@reduxjs/toolkit';

import { IDepositWithAsset, IDepositWithBalance } from '../../data/interfaces/events.interface';
import { Address, Commitment } from '../../interfaces/types.interface';
import { RootState } from '../store';
import { assetSelector, poolsSelector } from './slices.selectors';
import { myDepositsSelector } from './deposits.selector';
import { myWithdrawalsSelector } from './withdrawals.selector';

export type SpecificAssetBalanceSelectorFn = <
  const Adresses extends Address | Address[] = Address[],
>(state: RootState, assetAddress?: Adresses) => Adresses extends unknown[] ? Map<Address, bigint> : bigint;

export type SpecificAssetBalanceFn<isAsync extends boolean = false> = <
  const Adresses extends Address | Address[] = Address[],
  ReturnType = Adresses extends unknown[] ? Map<Address, bigint> : bigint,
>(assetAddress?: Adresses) => isAsync extends true ? Promise<ReturnType> : ReturnType;

/**
 * Provides a map of every commitment mapped to a deposit+assetAddress
 */
export const myDepositsWithAssetSelector = createSelector(
  [myDepositsSelector, poolsSelector],
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
      .filter((e): e is [Commitment, IDepositWithAsset] => e !== undefined);

    return new Map(depositsWithAssets);
  },
);

/**
 * Provides a map of every commitment mapped to deposit+asset+balance, accounting for withdrawals.
 */
export const myDepositsBalanceSelector = createSelector(
  [myWithdrawalsSelector, myDepositsWithAssetSelector, poolsSelector],
  (withdrawalsMap, myDeposits, pools): Map<Commitment, IDepositWithBalance> => {
    const depositsByCommitment = Array.from(myDeposits.values())
      .map((deposit): [Commitment, IDepositWithBalance] => {
        const withdrawal = withdrawalsMap.get(deposit.commitment);

        return [
          deposit.commitment,
          {
            ...deposit,
            balance: withdrawal ? 0n : pools.get(deposit.pool)!.denomination,
          },
        ] as const;
      });

    return new Map(depositsByCommitment);
  },
);

export const myAssetsBalanceSelector = createSelector(
  [myDepositsBalanceSelector],
  (depositsMap): Map<Address, bigint> => {
    const assetsBalanceMap = new Map<Address, bigint>();

    for (const deposit of depositsMap.values()) {
      const currentBalance = assetsBalanceMap.get(deposit.assetAddress) || 0n;

      assetsBalanceMap.set(deposit.assetAddress, currentBalance + deposit.balance);
    }

    return assetsBalanceMap;
  },
);

export const allAssetsBalanceSelector = createSelector(
  [myAssetsBalanceSelector, assetSelector],
  (myAssetsBalance, allAssets) => new Map(
    Array.from(allAssets)
      .map(([assetAddress]) => [assetAddress, myAssetsBalance.get(assetAddress) || 0n] as const),
  ),
);

export const specificAssetsBalanceSelector = createSelector(
  [
    allAssetsBalanceSelector,
    (_state: RootState, assetAddresses: Address[] | Address = []) => assetAddresses,
  ],
  (assetsBalanceMap, assetAddress) => {
    if (assetAddress instanceof Array) {
      const addresses = assetAddress.length === 0 ? [...assetsBalanceMap.keys()] : assetAddress;

      return new Map(addresses.map((address) => {
        const balance = assetsBalanceMap.get(address) || 0n;

        return [address, balance] as const;
      }));
    }

    return assetsBalanceMap.get(assetAddress) || 0n;
  },
) as SpecificAssetBalanceSelectorFn;
