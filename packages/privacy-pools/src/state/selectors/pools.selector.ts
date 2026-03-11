import { createSelector } from "@reduxjs/toolkit";

import { IPool } from "../../data/interfaces/events.interface";
import { Address, Commitment } from "../../interfaces/types.interface";
import { RootState } from "../store";
import { createMyEntrypointDepositsSelector } from "./deposits.selector";
import {
  depositsSelector,
  poolsLeavesSelector,
  poolsSelector,
  ragequitsSelector,
  withdrawalsSelector,
} from "./slices.selectors";

export const createMyPoolsSelector = (
  myEntrypointDepositsSelector: ReturnType<
    typeof createMyEntrypointDepositsSelector
  >,
) => {
  return createSelector(
    [myEntrypointDepositsSelector, poolsSelector],
    (myEntrypointDeposits, pools): IPool[] => {
      return Array.from(
        new Set(
          Array.from(myEntrypointDeposits.values()).map(
            ({ poolAddress }) => poolAddress,
          ),
        ),
      )
        .map((poolAddress) => pools.get(poolAddress))
        .filter((pool) => !!pool);
    },
  );
};

export const selectPoolLeaves = createSelector(
  [poolsLeavesSelector, (_, poolAddress: Address) => poolAddress],
  (poolsLeaves, poolAddress) => {
    const poolLeaves = poolsLeaves.get(poolAddress);

    if (!poolLeaves) {
      throw new Error('Pool to get leaves for not found.')
    }

    return poolLeaves;
  },
);

export const poolEventsSelector = createSelector(
  [
    depositsSelector,
    withdrawalsSelector,
    ragequitsSelector,
    selectPoolLeaves,
    (state: RootState, poolAddress: Address) => poolAddress,
  ],
  (deposits, withdrawals, ragequits, poolLeaves, poolAddress) => {
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

    // Filter ragequits by pool address
    const filteredRagequits = new Map(
      Array.from(ragequits).filter(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ([_, ragequit]) => ragequit.pool === poolAddress,
      ),
    );

    return {
      deposits: filteredDeposits,
      withdrawals: filteredWithdrawals,
      ragequits: filteredRagequits,
      leavesInserted: poolLeaves,
    };
  },
);

export const poolCommitmentsSelector = createSelector(
  [poolEventsSelector],
  (poolEvents): Set<Commitment> => {
    const { leavesInserted } = poolEvents;

    const leavesInsertedArray = Array.from(leavesInserted.values());

    const eventsSorterByBlockNumber = leavesInsertedArray.sort((a, b) => {
      return Number(a.index - b.index);
    });

    return new Set(
      eventsSorterByBlockNumber.map(({ commitment }) => commitment),
    );
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
