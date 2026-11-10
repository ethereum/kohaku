import { createAsyncThunk } from "@reduxjs/toolkit";
import { IDataService } from "../../data/interfaces/data.service.interface";
import {
  IPoolDepositEvent,
  IWithdrawalEvent,
  IRagequitEvent,
} from "../../data/interfaces/events.interface";
import { selectLastSyncedBlock } from "../selectors/last-synced-block.selector";
import { registerDeposits } from "../slices/depositsSlice";
import { registerRagequits } from "../slices/ragequitsSlice";
import { registerWithdrawals } from "../slices/withdrawalsSlice";
import { RootState } from "../store";
import { poolsSelector } from "../selectors/slices.selectors";
import { registerPoolLeaves } from "../slices/poolLeavesSlice";

export interface SyncEventsThunkParams {
  dataService: IDataService;
}

interface SyncEventsParams extends SyncEventsThunkParams {
  /** The sync's head; every pool is scanned up to it (see syncThunk). */
  toBlock: bigint;
}

export const syncEventsThunk = createAsyncThunk<
  void,
  SyncEventsParams,
  { state: RootState; }
>("sync/events", async ({ dataService, toBlock }, { getState, dispatch }) => {
  const state = getState();
  const myPools = poolsSelector(state);
  const lastSyncedBlock = selectLastSyncedBlock(state);

  // Fetch deposits, withdrawals, and ragequits from all pools in parallel. A failed
  // scan fails the sync: the head becomes the sync point, so a skipped pool's events
  // would never be fetched again.
  const results = await Promise.all(
    Array.from(myPools.values()).map(async (pool) => {
      const events = await dataService.getPoolEvents({
        events: ["PoolDeposited", "Withdrawn", "Ragequit", "LeafInserted"],
        fromBlock:
          lastSyncedBlock === 0n ? pool.registeredBlock : lastSyncedBlock,
        toBlock,
        address: pool.address,
      });

      return {
        ...events,
        pool: pool.address,
      };
    }),
  );

  // Collect all events from successful results
  const allDeposits: IPoolDepositEvent[] = [];
  const allWithdrawals: IWithdrawalEvent[] = [];
  const allRagequits: IRagequitEvent[] = [];

  results.forEach(({ PoolDeposited, Withdrawn, Ragequit, LeafInserted, pool }) => {
    allDeposits.push(...PoolDeposited.map((e) => ({ ...e, pool })));
    allWithdrawals.push(...Withdrawn.map((e) => ({ ...e, pool })));
    allRagequits.push(...Ragequit.map((e) => ({ ...e, pool })));

    // Each registerPoolLeaves dispatch rebuilds and re-serializes the entire
    // cross-pool leaf structure, so skip pools with no new leaves (the common
    // case on an already-synced state — otherwise every pool pays that cost).
    if (LeafInserted.length > 0) {
      dispatch(registerPoolLeaves({
        poolAddress: pool,
        leaves: LeafInserted,
      }));
    }
  });

  // Register all fetched events
  if (allDeposits.length > 0) {
    dispatch(registerDeposits(allDeposits));
  }

  if (allWithdrawals.length > 0) {
    dispatch(registerWithdrawals(allWithdrawals));
  }

  if (allRagequits.length > 0) {
    dispatch(registerRagequits(allRagequits));
  }
});
