/* eslint-disable max-lines */
import { createSelector } from '@reduxjs/toolkit';

import { IDepositWithAsset, IDepositWithBalance } from '../../data/interfaces/events.interface';
import { Address, Precommitment } from '../../interfaces/types.interface';
import { RootState } from '../store';
import { createMyDepositsSelector } from './deposits.selector';
import { createMyRagequitsSelector } from './ragequits.selector';
import { assetSelector, entrypointDepositSelector, poolsSelector } from './slices.selectors';
import { createMyWithdrawalsSelector } from './withdrawals.selector';

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
      entrypointDepositSelector,
      poolsSelector,
    ],
    (myDeposits, entrypointDepositsMap, poolsMap): Map<Precommitment, IDepositWithAsset> => {
      const depositsWithAssets = Array.from(myDeposits)
        .map(([precommitment, deposit]) => {
          const entrypointDeposit = entrypointDepositsMap.get(deposit.commitment);

          if (!entrypointDeposit) return undefined;

          const pool = poolsMap.get(entrypointDeposit.poolAddress);

          if (!pool) return undefined;

          return [precommitment, {
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
  myRagequitsSelector,
  myDepositsWithAssetSelector
}: {
  myWithdrawalsSelector: ReturnType<typeof createMyWithdrawalsSelector>,
  myRagequitsSelector: ReturnType<typeof createMyRagequitsSelector>,
  myDepositsWithAssetSelector: ReturnType<typeof createMyDepositsWithAssetSelector>,
}) => {

  return createSelector(
    [
      myWithdrawalsSelector,
      myRagequitsSelector,
      myDepositsWithAssetSelector,
    ],
    (withdrawalsMap, ragequitsMap, myDeposits): Map<Precommitment, IDepositWithBalance> => {
      const depositsByPrecommitment = Array.from(myDeposits.entries())
        .map(([precommitment, deposit]): [Precommitment, IDepositWithBalance] => {
          const depositData = myDeposits.get(deposit.precommitment);

          if (!depositData) {
            return [precommitment, {
              ...deposit,
              assetAddress: 0n,
              index: 0,
              balance: 0n,
            }] as const;
          }

          const ragequit = ragequitsMap.get(depositData.precommitment);

          if (ragequit) {
            return [precommitment, {
              ...depositData,
              balance: 0n,
            }] as const;
          }

          const withdrawals = withdrawalsMap.get(depositData.precommitment) || [];
          const totalWithdrawn = withdrawals.reduce((sum, withdrawal) => sum + withdrawal.value, 0n);

          return [precommitment, {
            ...depositData,
            balance: depositData.value - totalWithdrawn,
          }] as const;
        });

      return new Map(depositsByPrecommitment);
    }
  );
};

export class NotEnoughCommitsToSpendError extends Error { }

/**
 * Creates a selector that returns the deposits with non-zero balance
 * balance := deposit.value - sum( all withdraw(deposit).value )
 *
 * Deposits could still be unapproved
 *
 * @param assetAddress bigint
 * @param amount bigint
 * @returns IDepositWithBalance[]
 */
export const createDepositsToSpendSelector = ({
  myDepositsBalanceSelector,
}: { myDepositsBalanceSelector: ReturnType<typeof createMyDepositsBalanceSelector> }) => {

  return createSelector(
    [
      myDepositsBalanceSelector,
      (_state: RootState, assetAddress: bigint, amount: bigint) => ({ assetAddress, amount }),
    ],
    (depositsMap, { assetAddress, amount }): IDepositWithBalance[] => {
      // Filter deposits by asset address and positive balance
      const filteredDeposits = Array.from(depositsMap.values())
        .filter(deposit => deposit.assetAddress === assetAddress && deposit.balance > 0n);

      const depositsToSpend: IDepositWithBalance[] = [];
      let remainingAmount = amount;

      for (const deposit of filteredDeposits) {
        if (remainingAmount <= 0n) {
          break;
        }

        depositsToSpend.push(deposit);
        remainingAmount -= deposit.balance;
      }

      if (remainingAmount > 0) {
        throw new NotEnoughCommitsToSpendError(`Remaining ${remainingAmount.toString(10)} to spend.`);
      }

      return depositsToSpend;
    }
  );
};

interface IAssetBalance {
  approved: bigint;
  unapproved: bigint;
}

export const createMyAssetsBalanceSelector = ({
  myDepositsBalanceSelector,
}: { myDepositsBalanceSelector: ReturnType<typeof createMyDepositsBalanceSelector> }) => {

  return createSelector(
    [myDepositsBalanceSelector],
    (depositsMap): Map<Address, IAssetBalance> => {
      const assetsBalanceMap = new Map<bigint, IAssetBalance>();

      for (const deposit of depositsMap.values()) {
        const currentBalance = assetsBalanceMap.get(deposit.assetAddress) || { approved: 0n, unapproved: 0n };
        const balanceKey = deposit.approved ? 'approved' : 'unapproved';

        assetsBalanceMap.set(deposit.assetAddress, {
          ...currentBalance,
          [balanceKey]: currentBalance[balanceKey] + deposit.balance,
        });
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
      .map(([assetAddress]) => [assetAddress, myAssetsBalance.get(assetAddress) || { approved: 0n, unapproved: 0n }] as const)
  )
})

type BalanceOutput<T extends 'approved' | 'unapproved' | 'both'> = T extends 'both' ? IAssetBalance : IAssetBalance[keyof IAssetBalance];
export type IBalanceType = 'approved' | 'unapproved' | 'both';

export type SpecificAssetBalanceSelectorFn = <
  const Adresses extends Address | Address[] = Address[],
  const BalanceType extends IBalanceType = 'both'
>(state: RootState, assetAddress?: Adresses, balanceType?: BalanceType) => Adresses extends unknown[] ? Map<Address, BalanceOutput<BalanceType>> : BalanceOutput<BalanceType>;

export type SpecificAssetBalanceFn<isAsync extends boolean = false> = <
  const Adresses extends Address | Address[] = Address[],
  const BalanceType extends IBalanceType = 'both',
  ReturnType = Adresses extends unknown[] ? Map<Address, BalanceOutput<BalanceType>> : BalanceOutput<BalanceType>,
>(assetAddress?: Adresses, balanceType?: BalanceType) => isAsync extends true ? Promise<ReturnType> : ReturnType;

export const createSpecificAssetBalanceSelector = (
  allAssetsBalanceSelector: ReturnType<typeof createAllAssetsBalanceSelector>
): SpecificAssetBalanceSelectorFn => {
  return createSelector(
    [
      allAssetsBalanceSelector,
      (_state: RootState, assetAddresses: Address[] | Address = []) => assetAddresses,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (_: RootState, _assetAddresses: Address[] | Address = [], balanceType: IBalanceType = 'both') => balanceType
    ],
    (assetsBalanceMap, assetAddress, balanceType) => {
      if (assetAddress instanceof Array) {
        const addresses = assetAddress.length === 0 ? [...assetsBalanceMap.keys()] : assetAddress;

        return new Map(addresses.map((address) => {
          const balance = assetsBalanceMap.get(address) || { approved: 0n, unapproved: 0n };
          const returnBalance: BalanceOutput<typeof balanceType> = balanceType === 'both' ? balance : balance[balanceType];

          return [address, returnBalance] as const
        }));
      }

      const balance = assetsBalanceMap.get(assetAddress) || { approved: 0n, unapproved: 0n };

      return balanceType === 'both' ? balance : balance[balanceType];
    }
  ) as SpecificAssetBalanceSelectorFn;
};

export const createMyApprovedAssetBalanceSelector = (
  myAssetsBalanceSelector: ReturnType<typeof createMyAssetsBalanceSelector>
) => {
  return createSelector(
    [
      myAssetsBalanceSelector,
    ],
    (assetsBalanceMap): Map<Address, bigint> => {
      return new Map(
        Array.from(assetsBalanceMap)
          .map(([assetAddress, balance]) => [assetAddress, balance.approved] as const),
      )
    }
  );
};

export const createMyUnapprovedAssetBalanceSelector = (
  myAssetsBalanceSelector: ReturnType<typeof createMyAssetsBalanceSelector>
) => {
  return createSelector(
    [
      myAssetsBalanceSelector,
    ],
    (assetsBalanceMap): Map<Address, bigint> => {
      return new Map(
        Array.from(assetsBalanceMap)
          .map(([assetAddress, balance]) => [assetAddress, balance.unapproved] as const),
      )
    }
  );
};
