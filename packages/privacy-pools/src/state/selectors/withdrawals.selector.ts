import { createSelector } from "@reduxjs/toolkit";
import { ISecretManager } from "../../account/keys";
import { IIndexedWithdrawalEvent } from "../../data/interfaces/events.interface";
import { Precommitment } from "../../interfaces/types.interface";
import { createMyDepositsSelector } from "./deposits.selector";
import {
  entrypointInfoSelector,
  withdrawalsSelector,
} from "./slices.selectors";

export type DepositsWithdrawals = Map<Precommitment, IIndexedWithdrawalEvent[]>;

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
    [myDepositsSelector, withdrawalsSelector, entrypointInfoSelector],
    (myDeposits, withdrawalsMap, entrypointInfo): DepositsWithdrawals => {
      const myWithdrawals: DepositsWithdrawals = new Map();
      const { chainId, entrypointAddress } = entrypointInfo;

      for (const [, deposit] of myDeposits) {
        const mapKey = deposit.precommitment;
        const depositWithdrawals = myWithdrawals.get(mapKey) || [];

        for (let withdrawIndex = 0; ; withdrawIndex++) {
          const { nullifierHash } = secretManager.getSecrets({
            entrypointAddress,
            chainId,
            depositIndex: deposit.index,
            withdrawIndex,
          });

          const withdrawal = withdrawalsMap.get(nullifierHash);

          if (!withdrawal) {
            break;
          }

          depositWithdrawals.push({
            ...withdrawal,
            label: deposit.label,
            index: withdrawIndex,
          });
        }
        myWithdrawals.set(mapKey, depositWithdrawals);
      }

      return myWithdrawals;
    },
  );
};
