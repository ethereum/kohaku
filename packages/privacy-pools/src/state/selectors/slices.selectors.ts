import { selectEntityMap } from "../utils/selectors.utils";
import { deserialize } from "../utils/serialize.utils";
import { RootState } from "../store";
import { AspState } from "../slices/aspSlice";
import { UpdateRootEventsState } from "../slices/updateRootEventsSlice";
import { EntrypointInfoState } from "../slices/entrypointInfoSlice";

import {
  Address,
  Commitment,
  Label,
  Nullifier,
  Precommitment,
} from "../../interfaces/types.interface";
import {
  IAsset,
  IEntrypointDepositEvent,
  ILeafInsertedEvent,
  IPool,
  IPoolDepositEvent,
  IRagequitEvent,
  IWithdrawalEvent,
} from "../../data/interfaces/events.interface";
import { createSelector } from "@reduxjs/toolkit";

export const depositsSelector = selectEntityMap(
  (s) => s.deposits.depositsTuples,
  deserialize as () => [Precommitment, IPoolDepositEvent],
);

export const entrypointDepositSelector = selectEntityMap(
  (s) => s.entrypointDeposits.entrypointDepositsTuples,
  deserialize as () => [Commitment, IEntrypointDepositEvent],
);

export const aspSelector = createSelector(
  [(state: RootState) => state.asp],
  (asp) => deserialize(asp) as AspState,
);

export const poolsLeavesSelector = createSelector(
  [(state: RootState) => state.poolsLeaves.poolLeavesTuples],
  (poolsLeaves): Map<Address, Map<bigint, ILeafInsertedEvent>> => {
    const deserializedPoolsLeaves = deserialize(poolsLeaves);

    return new Map(
      deserializedPoolsLeaves.map(
        ([poolAddress, leavesMap]) =>
          [poolAddress, new Map(leavesMap)] as const,
      ),
    );
  },
);

export const lastUpdateRootEventSelector = createSelector(
  [(state: RootState) => state.updateRootEvents.lastUpdateRootEvent],
  (lastUpdateRootEvent) => {
    if (!lastUpdateRootEvent) {
      return lastUpdateRootEvent;
    }

    return deserialize(lastUpdateRootEvent, {
      ipfsCID: true,
    }) as UpdateRootEventsState["lastUpdateRootEvent"];
  },
);

export const entrypointInfoSelector = createSelector(
  [(state: RootState) => state.entrypointInfo],
  (poolInfo) => deserialize(poolInfo) as EntrypointInfoState,
);

/**
 * Maps asset address to IPoolInfo
 *
 */
export const poolsSelector = selectEntityMap(
  (s) => s.pools.poolsTuples,
  deserialize as () => [Address, IPool],
);

export const withdrawalsSelector = selectEntityMap(
  (s) => s.withdrawals.withdrawalsTuples,
  deserialize as () => [Nullifier, IWithdrawalEvent],
);

export const ragequitsSelector = selectEntityMap(
  (s) => s.ragequits.ragequitsTuples,
  deserialize as () => [Label, IRagequitEvent],
);

export const assetSelector = selectEntityMap(
  (s) => s.assets.assetsTuples,
  (assetsTuple) =>
    deserialize(assetsTuple, [undefined, { name: true, symbol: true }]) as [
      Address,
      IAsset,
    ],
);
