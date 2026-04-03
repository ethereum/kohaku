import { createSelector } from "@reduxjs/toolkit";
import { ISecretManager } from "../../account/keys";
import { IIndexedWithdrawalEvent } from "../../data/interfaces/events.interface";
import { Commitment } from "../../interfaces/types.interface";
import { createMyDepositsSelector } from "./deposits.selector";
import {
  instanceRegistryInfoSelector,
  withdrawalsSelector,
} from "./slices.selectors";

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
