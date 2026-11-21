import { createSelector } from "@reduxjs/toolkit";
import { IIndexedDepositWithSecrets, IIndexedWithdrawalEvent, IPool } from "../../data/interfaces/events.interface";
import { Address, Commitment, NullifierHash } from "../../interfaces/types.interface";
import { addressToHex } from "../../utils";
import { RootState } from "../store";
import { UserSecretEntry } from "../slices/userSecretsSlice";
import { myDepositsSelector } from "./deposits.selector";
import {
  activePoolsSelector,
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
    activePoolsSelector,
    userSecretsSelector,
  ],
  (deposits, withdrawals, pools, userSecrets) => {
    // Build a fast lookup: commitmentHex → full secret record
    const unspentDepositsByPool = new Map<Address, IIndexedDepositWithSecrets[]>([...pools.keys()].map((address) => [address, []]));
    const secretByCommitment = new Map<Commitment, UserSecretEntry>();

    for (const records of userSecrets.values()) {
      for (const r of records) {
        secretByCommitment.set(r.commitment, r);
      }
    }

    for (const [commitment, deposit] of deposits) {
      const depositSecrets = secretByCommitment.get(commitment)!;

      // If the deposit is already withdrawn skip it
      if (withdrawals.get(depositSecrets.nullifierHash)) continue;
      
      const poolDeposits = unspentDepositsByPool.get(deposit.pool);

      if (!poolDeposits) continue;

      poolDeposits.push({
        ...deposit,
        ...depositSecrets
      });
    }

    return unspentDepositsByPool;
  }
)

/** Try pool counts instead of note subsets, keeping the largest-first preference. */
function findExactDeposits(
  pools: IPool[],
  unspent: Map<Address, IIndexedDepositWithSecrets[]>,
  amount: bigint,
): IIndexedDepositWithSecrets[] | undefined {
  const candidates = pools.map(pool => ({ denomination: pool.denomination, deposits: unspent.get(pool.address)! }))
    .filter(({ denomination, deposits }) => denomination > 0n && deposits.length > 0);
  const capacity = Array<bigint>(candidates.length + 1).fill(0n);
  const divisor = [...capacity];
  const failed = candidates.map(() => new Set<bigint>());

  for (let index = candidates.length - 1; index >= 0; index--) {
    const { denomination, deposits } = candidates[index]!;

    capacity[index] = capacity[index + 1]! + denomination * BigInt(deposits.length);
    let a = denomination;
    let b = divisor[index + 1]!;

    while (b !== 0n) [a, b] = [b, a % b];
    divisor[index] = a;
  }

  const search = (index: number, remaining: bigint): IIndexedDepositWithSecrets[] | undefined => {
    if (remaining === 0n) return [];

    if (index === candidates.length || remaining > capacity[index]! || remaining % divisor[index]! !== 0n || failed[index]!.has(remaining)) return undefined;

    const { denomination, deposits } = candidates[index]!;
    const maxCount = Number(remaining / denomination < BigInt(deposits.length) ? remaining / denomination : BigInt(deposits.length));
    const needed = remaining > capacity[index + 1]! ? remaining - capacity[index + 1]! : 0n;
    const minCount = Number((needed + denomination - 1n) / denomination);

    for (let count = maxCount; count >= minCount; count--) {
      const rest = search(index + 1, remaining - denomination * BigInt(count));

      if (rest) return [...deposits.slice(0, count), ...rest];
    }

    failed[index]!.add(remaining);

    return undefined;
  };

  return search(0, amount);
}

/**
 * Returns unspent deposits with their full secrets, ready for proof generation.
 * Reads secrets directly from the userSecrets slice — no secretManager call needed.
 */
export const getWithdrawableDepositsSelector = createSelector(
  [
    getUnspentDepositsByPool,
    activePoolsSelector,
    (_state: RootState, assetAddress: Address) => assetAddress,
    (_state: RootState, _assetAddress: Address, amount?: bigint) => amount,
  ],
  (unspentDepositsByPool, pools, assetAddress, amount): IIndexedDepositWithSecrets[] => {
    if (amount !== undefined && amount <= 0n) {
      throw new Error('Withdrawal amount must be positive.');
    }

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
      if (amount !== undefined && amountToWithdraw + pool.denomination > amount) {
        continue;
      }

      const poolDeposits = unspentDepositsByPool.get(pool.address)!;

      for (const deposit of poolDeposits) {
        // If we would withdraw over the requested amount we skip this pool
        if (amount !== undefined && amountToWithdraw + pool.denomination > amount) {
          break;
        }

        result.push(deposit);
        
        amountToWithdraw += pool.denomination;
      }
    }

    if (amount !== undefined && amountToWithdraw < amount) {
      const exact = findExactDeposits(poolsToWithdrawFrom, unspentDepositsByPool, amount);

      if (exact) return exact;

      throw new Error(
        `Insufficient balance to spend. Got ${amountToWithdraw}. Expected at least: ${amount}`,
      );
    }

    return result;
  },
);
