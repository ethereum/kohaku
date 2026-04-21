import { createSelector } from "@reduxjs/toolkit";
import { IIndexedDepositWithSecrets, IIndexedWithdrawalEvent } from "../../data/interfaces/events.interface";
import { Address, Commitment, NullifierHash } from "../../interfaces/types.interface";
import { addressToHex } from "../../utils";
import { RootState } from "../store";
import { UserSecretRecord } from "../slices/userSecretsSlice";
import { myDepositsSelector } from "./deposits.selector";
import {
  poolsSelector,
  userSecretsSelector,
  withdrawalsSelector,
} from "./slices.selectors";

export type DepositsWithdrawals = Map<Commitment, IIndexedWithdrawalEvent>;

/**
 * Returns withdrawals grouped by deposit commitment.
 * Uses nullifierHashes stored in userSecrets to identify which withdrawals belong to this user.
 */
export const myWithdrawalsSelector = createSelector(
  [myDepositsSelector, withdrawalsSelector, userSecretsSelector],
  (myDeposits, withdrawalsMap, userSecrets): DepositsWithdrawals => {
    const nullifierHashByCommitment = new Map<Commitment, NullifierHash>();

    for (const records of Object.values(userSecrets) as UserSecretRecord[][]) {
      for (const r of records) {
        nullifierHashByCommitment.set(r.commitment, r.nullifierHash);
      }
    }

    const myWithdrawals: DepositsWithdrawals = new Map();

    for (const [, deposit] of myDeposits) {
      const nullifierHash = nullifierHashByCommitment.get(deposit.commitment);

      if (!nullifierHash) continue;

      const withdrawal = withdrawalsMap.get(BigInt(nullifierHash) as Commitment);

      if (!withdrawal) continue;

      myWithdrawals.set(deposit.commitment, {
        ...withdrawal,
        commitment: deposit.commitment,
      });
    }

    return myWithdrawals;
  },
);

/**
 * Returns unspent deposits with their full secrets, ready for proof generation.
 * Reads secrets directly from the userSecrets slice — no secretManager call needed.
 */
export const getWithdrawableDepositsSelector = createSelector(
  [
    myDepositsSelector,
    withdrawalsSelector,
    poolsSelector,
    userSecretsSelector,
    (_state: RootState, assetAddress: Address) => assetAddress,
    (_state: RootState, _assetAddress: Address, amount?: bigint) => amount,
  ],
  (myDeposits, withdrawals, pools, userSecrets, assetAddress, amount): IIndexedDepositWithSecrets[] => {
    // Build a fast lookup: commitmentHex → full secret record
    const secretByCommitment = new Map<Commitment, UserSecretRecord>();

    for (const records of Object.values(userSecrets) as UserSecretRecord[][]) {
      for (const r of records) {
        secretByCommitment.set(r.commitment, r);
      }
    }

    // Pools sorted from lowest to biggest denomination
    const poolsToWithdrawFrom = Array.from(pools.values())
      .filter((p) => p.asset === assetAddress)
      .sort((a, b) => Number(a.denomination - b.denomination));

    if (!poolsToWithdrawFrom[0]) {
      throw new Error(`Pool for asset ${addressToHex(assetAddress)} not found.`);
    }

    let amountToWithdraw = 0n;
    const result: IIndexedDepositWithSecrets[] = [];

    for (const deposit of myDeposits.values()) {
      const pool = pools.get(deposit.pool);

      if (!pool) continue;

      const secretRecord = secretByCommitment.get(deposit.commitment);

      if (!secretRecord) continue;

      const nullifierHash = BigInt(secretRecord.nullifierHash) as Commitment;

      if (withdrawals.has(nullifierHash)) continue;

      result.push({
        ...deposit,
        nullifier: BigInt(secretRecord.nullifier),
        salt: BigInt(secretRecord.salt),
        commitment: deposit.commitment,
        nullifierHash,
      });

      amountToWithdraw += pool.denomination;

      if (amount && amountToWithdraw >= amount) break;
    }

    if (amount && amountToWithdraw < amount) {
      throw new Error(
        `Insufficient balance to spend. Got ${amountToWithdraw}. Expected at least: ${amount}`,
      );
    }

    return result;
  },
);
