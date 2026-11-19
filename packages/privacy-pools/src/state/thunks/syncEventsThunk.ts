import { createAsyncThunk } from "@reduxjs/toolkit";
import { IDataService } from "../../data/interfaces/data.service.interface";
import {
  IPoolDepositEvent,
  IWithdrawalEvent,
  IRagequitEvent,
} from "../../data/interfaces/events.interface";
import { registerDeposits } from "../slices/depositsSlice";
import { registerRagequits } from "../slices/ragequitsSlice";
import { registerWithdrawals } from "../slices/withdrawalsSlice";
import { RootState } from "../store";
import { poolsSelector } from "../selectors/slices.selectors";
import { registerPoolLeaves } from "../slices/poolLeavesSlice";

const POOL_SYNC_BATCH_SIZE = 4;

export interface SyncEventsThunkParams {
  dataService: IDataService;
}

interface SyncEventsParams extends SyncEventsThunkParams {
  /** The sync's cursor: everything after it was pruned and is scanned again. */
  fromBlock: bigint;
  /** The sync's head; every pool is scanned up to it (see syncThunk). */
  toBlock: bigint;
}

export const syncEventsThunk = createAsyncThunk<
  void,
  SyncEventsParams,
  { state: RootState; }
>("sync/events", async ({ dataService, fromBlock, toBlock }, { getState, dispatch }) => {
  const pools = Array.from(poolsSelector(getState()).values());

  // Bound in-flight scans and temporary results. A failed batch still fails sync;
  // the cursor stays unchanged and the next sync prunes/replays completed batches.
  for (let start = 0; start < pools.length; start += POOL_SYNC_BATCH_SIZE) {
    const results = await Promise.all(
      pools.slice(start, start + POOL_SYNC_BATCH_SIZE).map(async (pool) => {
        const events = await dataService.getPoolEvents({
          events: ["PoolDeposited", "Withdrawn", "Ragequit", "LeafInserted"],
          fromBlock: fromBlock === 0n ? pool.registeredBlock : fromBlock,
          toBlock,
          address: pool.address,
        });

        return { ...events, pool: pool.address };
      }),
    );
    const allDeposits: IPoolDepositEvent[] = [];
    const allWithdrawals: IWithdrawalEvent[] = [];
    const allRagequits: IRagequitEvent[] = [];

    for (const { PoolDeposited, Withdrawn, Ragequit, LeafInserted, pool } of results) {
      for (const event of PoolDeposited) allDeposits.push({ ...event, pool });

      for (const event of Withdrawn) allWithdrawals.push({ ...event, pool });

      for (const event of Ragequit) allRagequits.push({ ...event, pool });

      // Empty pools need no cross-pool leaf rebuild.
      if (LeafInserted.length > 0) {
        dispatch(registerPoolLeaves({ poolAddress: pool, leaves: LeafInserted }));
      }
    }

    if (allDeposits.length > 0) {
      dispatch(registerDeposits(allDeposits));
    }

    if (allWithdrawals.length > 0) {
      dispatch(registerWithdrawals(allWithdrawals));
    }

    if (allRagequits.length > 0) {
      dispatch(registerRagequits(allRagequits));
    }
  }
});
