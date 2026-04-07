import { createSelector } from "@reduxjs/toolkit";

import { IPool } from "../../data/interfaces/events.interface";
import { Address, Commitment } from "../../interfaces/types.interface";
import { computeMerkleTreeRoot } from "../../utils/proof.util";
import { RootState } from "../store";
import {
  depositsSelector,
  poolsSelector,
  withdrawalsSelector,
} from "./slices.selectors";

export const poolEventsSelector = createSelector(
  [
    depositsSelector,
    withdrawalsSelector,
    (state: RootState, poolAddress: Address) => poolAddress,
  ],
  (deposits, withdrawals, poolAddress) => {
    // Filter deposits by pool address
    const filteredDeposits = new Map(
      Array.from(deposits).filter(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ([_, deposit]) => deposit.pool === poolAddress,
      ),
    );

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
    const leaves = Array.from(commitments);

    if (leaves.length === 0) {
      return 0n;
    }

    return computeMerkleTreeRoot(leaves);
  },
);

export const poolFromAssetSelector = createSelector(
  [poolsSelector, (state: RootState, assetAddress: Address) => assetAddress],
  (pools, assetAddress: Address): IPool | undefined => {
    const addressPoolTuple = Array.from(pools).find(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ([_, p]) => p.asset === assetAddress,
    );

    if (!addressPoolTuple) {
      return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, poolInfo] = addressPoolTuple;

    return poolInfo;
  },
);
