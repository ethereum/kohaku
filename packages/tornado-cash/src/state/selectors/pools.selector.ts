import { createSelector } from "@reduxjs/toolkit";

import { IDepositEvent } from "../../data/interfaces/events.interface";
import { Address, Commitment } from "../../interfaces/types.interface";
import { buildTree } from "#merkle-tree";
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

export const poolCommitmentsSelector = createSelector(
  [poolEventsSelector],
  ({ deposits }): Set<Commitment> => {

    const leavesInsertedArray = Array.from(deposits.values());

    const eventsSorterByBlockNumber = leavesInsertedArray.sort((a, b) => {
      return a.leafIndex - b.leafIndex;
    });

    return new Set(
      eventsSorterByBlockNumber.map(({ commitment }) => commitment),
    );
  },
);

export const poolMerkleTreeRootSelector = createSelector(
  [poolCommitmentsSelector],
  async (commitments): Promise<bigint> => {
    const start = new Date();
    const leaves = Array.from(commitments);

    if (leaves.length === 0) {
      return 0n;
    }

    const {root} = await buildTree(leaves);
    const end = new Date();

    console.log(`Merkle tree for ${leaves.length} leaves took ${ +end - +start }ms`);

    return BigInt(root);
  },
);
