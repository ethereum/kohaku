import { createSelector } from "@reduxjs/toolkit";

import { IDepositEvent } from "../../data/interfaces/events.interface";
import { Address, Commitment } from "../../interfaces/types.interface";
import { buildTree } from "#merkle-tree";
import type { MerkleTree } from "@kohaku-eth/mimc-tree";
import { RootState } from "../store";
import {
  depositsSelector,
  withdrawalsSelector,
} from "./slices.selectors";

export const poolEventsSelector = createSelector(
  [
    depositsSelector,
    withdrawalsSelector,
    (state: RootState, poolAddress: Address) => poolAddress,
  ],
  (deposits, withdrawals, poolAddress) => {
    const filteredDeposits = deposits.get(poolAddress) ?? new Map<Commitment, IDepositEvent>();

    // Filter withdrawals by pool address
    const filteredWithdrawals = new Map(
      Array.from(withdrawals).filter(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ([_, withdrawal]) => withdrawal.pool === poolAddress,
      ),
    );

    return {
      deposits: filteredDeposits,
      withdrawals: filteredWithdrawals,
    };
  },
);

// Depends on deposits only, so syncing withdrawals keeps the same Set and the cached tree below.
export const poolCommitmentsSelector = createSelector(
  [
    depositsSelector,
    (_state: RootState, poolAddress: Address) => poolAddress,
  ],
  (deposits, poolAddress): Set<Commitment> => {

    const leavesInsertedArray = Array.from(deposits.get(poolAddress)?.values() ?? []);

    const eventsSorterByBlockNumber = leavesInsertedArray.sort((a, b) => {
      return a.leafIndex - b.leafIndex;
    });

    return new Set(
      eventsSorterByBlockNumber.map(({ commitment }) => commitment),
    );
  },
);

// One tree per pool leaf set, shared by root verification and every withdrawal proof.
// A failed build is evicted so a retry rebuilds instead of replaying the rejection.
const poolTrees = new WeakMap<Set<Commitment>, Promise<MerkleTree>>();

/**
 * MUST ONLY BE USED IN THUNKS
 */
export const poolMerkleTreeSelector = (state: RootState, poolAddress: Address): Promise<MerkleTree> => {
  const commitments = poolCommitmentsSelector(state, poolAddress);
  const cached = poolTrees.get(commitments);

  if (cached) {
    return cached;
  }

  const start = new Date();
  const tree = buildTree(Array.from(commitments)).then((built) => {
    const end = new Date();

    console.log(`Merkle tree for ${commitments.size} leaves took ${ +end - +start }ms`);

    return built;
  });

  poolTrees.set(commitments, tree);
  tree.catch(() => poolTrees.delete(commitments));

  return tree;
};

export const poolMerkleTreeRootSelector = async (state: RootState, poolAddress: Address): Promise<bigint> => {
  if (poolCommitmentsSelector(state, poolAddress).size === 0) {
    return 0n;
  }

  const { root } = await poolMerkleTreeSelector(state, poolAddress);

  return BigInt(root);
};
