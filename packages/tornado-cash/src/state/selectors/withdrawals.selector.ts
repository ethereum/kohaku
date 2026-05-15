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

    for (const records of userSecrets.values()) {
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

const getUnspentDepositsByPool = createSelector(
  [
    myDepositsSelector,
    withdrawalsSelector,
    poolsSelector,
    userSecretsSelector,
  ],
  (deposits, withdrawals, pools, userSecrets) => {
    // Build a fast lookup: commitmentHex → full secret record
    const unspentDepositsByPool = new Map<Address, IIndexedDepositWithSecrets[]>([...pools.keys()].map((address) => [address, []]));
    const secretByCommitment = new Map<Commitment, UserSecretRecord>();

    for (const records of userSecrets.values()) {
      for (const r of records) {
        secretByCommitment.set(r.commitment, r);
      }
    }

    for (const [commitment, deposit] of deposits) {
      const depositSecrets = secretByCommitment.get(commitment)!;

      // If the deposit is already withdrawn skip it
      if (withdrawals.get(depositSecrets.nullifierHash)) continue;
      
      unspentDepositsByPool.get(deposit.pool)!.push({
        ...deposit,
        ...depositSecrets
      });
    }

    return unspentDepositsByPool;
  }
)

/**
 * Returns unspent deposits with their full secrets, ready for proof generation.
 * Reads secrets directly from the userSecrets slice — no secretManager call needed.
 */
export const getWithdrawableDepositsSelector = createSelector(
  [
    getUnspentDepositsByPool,
    poolsSelector,
    (_state: RootState, assetAddress: Address) => assetAddress,
    (_state: RootState, _assetAddress: Address, amount?: bigint) => amount,
  ],
  (unspentDepositsByPool, pools, assetAddress, amount): IIndexedDepositWithSecrets[] => {
    // Pools sorted from biggest to lowest denomination
    const poolsToWithdrawFrom = Array.from(pools.values())
      .filter((p) => p.asset === assetAddress)
      .sort((a, b) => Number(b.denomination - a.denomination));

    if (!poolsToWithdrawFrom[0]) {
      throw new Error(`Pool for asset ${addressToHex(assetAddress)} not found.`);
    }

    let amountToWithdraw = 0n;
    const result: IIndexedDepositWithSecrets[] = [];

    for (const pool of poolsToWithdrawFrom) {
      // If we would withdraw over the request amount we skip the pool
      if (amount && amountToWithdraw + pool.denomination > amount) {
        continue;
      }

      const poolDeposits = unspentDepositsByPool.get(pool.address)!;

      for (const deposit of poolDeposits) {
        // If we would withdraw over the requested amount we skip this pool
        if (amount && amountToWithdraw + pool.denomination > amount) {
          break;
        }

        result.push(deposit);
        
        amountToWithdraw += pool.denomination;
      }
    }

    if (amount && amountToWithdraw < amount) {
      throw new Error(
        `Insufficient balance to spend. Got ${amountToWithdraw}. Expected at least: ${amount}`,
      );
    }

    return result;
  },
);
