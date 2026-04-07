import { createSelector } from "@reduxjs/toolkit";
import { ISecretManager, Secret } from "../../account/keys";
import { IIndexedDepositEvent, IIndexedDepositWithSecrets, IIndexedWithdrawalEvent } from "../../data/interfaces/events.interface";
import { Address, Commitment } from "../../interfaces/types.interface";
import { createMyDepositsSelector } from "./deposits.selector";
import {
  instanceRegistryInfoSelector,
  poolsSelector,
  withdrawalsSelector,
} from "./slices.selectors";
import { RootState } from "../store";
import { addressToHex } from "../../utils";

export type DepositsWithdrawals = Map<Commitment, IIndexedWithdrawalEvent>;

export const createMyWithdrawalsSelector = ({
  secretManager,
  myDepositsSelector,
}: {
  secretManager: ISecretManager;
  myDepositsSelector: ReturnType<typeof createMyDepositsSelector>;
}) => {
  /**
   * Returns the withdrawals grouped by deposit precommitment
   */
  return createSelector(
    [myDepositsSelector, withdrawalsSelector, instanceRegistryInfoSelector],
    (myDeposits, withdrawalsMap, entrypointInfo): DepositsWithdrawals => {
      const myWithdrawals: DepositsWithdrawals = new Map();
      const { chainId } = entrypointInfo;

      for (const [, deposit] of myDeposits) {
        const mapKey = deposit.commitment;

        const { nullifierHash } = secretManager.getDepositSecrets({
          poolAddress: deposit.pool,
          chainId,
          depositIndex: deposit.index,
        });
        
        const withdrawal = withdrawalsMap.get(nullifierHash);

        if (!withdrawal) {
          break;
        }
    
        myWithdrawals.set(mapKey, {
          ...withdrawal,
          commitment: deposit.commitment
        });
      }

      return myWithdrawals;
    },
  );
};

export const createGetWithdrawableDepositsSelector = ({
  myDepositsSelector,
  secretsManager,
}: {
  myDepositsSelector: ReturnType<typeof createMyDepositsSelector>;
  secretsManager: ISecretManager;
}) => {
  return createSelector(
    [
      myDepositsSelector,
      withdrawalsSelector,
      poolsSelector,
      instanceRegistryInfoSelector,
      (_state: RootState, assetAddress: Address) => assetAddress,
      (_state: RootState, _assetAddress: Address, amount?: bigint) => amount,
    ],
    (myDeposits, withdrawals, pools, { chainId }, assetAddress, amount): IIndexedDepositWithSecrets[] => {
      // Pools sorted from lowest to biggest denomination
      const poolsToWithdrawfrom = Array.from(pools.values())
        .filter((p) => p.asset === assetAddress)
        .sort((a, b) => Number(b.denomination - a.denomination));
      
      const smallestPool = poolsToWithdrawfrom[0];

      if (!smallestPool) {
        throw new Error(`Pool for asset ${addressToHex(assetAddress)} not found.`);
      }
      
      let amountToWithdraw = 0n;
      const result: IIndexedDepositWithSecrets[] = [];

      for (const deposit of myDeposits.values()) {
        const pool = pools.get(deposit.pool);
        if (!pool) continue;

        const secrets = secretsManager.getDepositSecrets({
          poolAddress: deposit.pool,
          chainId,
          depositIndex: deposit.index,
        });

        if (withdrawals.has(secrets.nullifierHash)) continue;

        result.push({
          ...deposit,
          ...secrets,
        });
        amountToWithdraw += pool.denomination;

        if (amount && amountToWithdraw >= amount) break;
      }

      if (amount && amountToWithdraw < amount) {
        throw new Error(`Insufficient balance to spend. Got ${amountToWithdraw}. Expected at least: ${amount}`);
      }

      return result;
    }
  );
};