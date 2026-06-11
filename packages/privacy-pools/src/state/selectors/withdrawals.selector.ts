import { createSelector } from "@reduxjs/toolkit";
import { IIndexedWithdrawalEvent } from "../../data/interfaces/events.interface";
import { Nullifier, Precommitment } from "../../interfaces/types.interface";
import {
  depositsSelector,
  userSecretsSelector,
  withdrawalsSelector,
} from "./slices.selectors";

export type DepositsWithdrawals = Map<Precommitment, IIndexedWithdrawalEvent[]>;

export const myWithdrawalsSelector = createSelector(
  [userSecretsSelector, withdrawalsSelector, depositsSelector],
  (userSecretsMap, withdrawalsMap, depositsMap): DepositsWithdrawals => {
    const result: DepositsWithdrawals = new Map();

    for (const [precommitment, record] of userSecretsMap) {
      const deposit = depositsMap.get(precommitment);

      if (!deposit) continue;

      const spentCount = record.noteSecrets.length - 1;
      const depositWithdrawals: IIndexedWithdrawalEvent[] = [];

      for (let noteIndex = 0; noteIndex < spentCount; noteIndex++) {
        const noteSecrets = record.noteSecrets[noteIndex];

        if (!noteSecrets) continue;

        const withdrawal = withdrawalsMap.get(noteSecrets.nullifierHash as Nullifier);

        if (withdrawal) {
          depositWithdrawals.push({ ...withdrawal, label: deposit.label, index: noteIndex });
        }
      }

      result.set(precommitment, depositWithdrawals);
    }

    return result;
  },
);
