import { createAsyncThunk } from "@reduxjs/toolkit";
import { ISyncService } from "../../data/interfaces/sync.service.interface";
import {
  IDepositEvent,
  IWithdrawalEvent,
} from "../../data/interfaces/events.interface";
import { registerDeposits } from "../slices/depositsSlice";
import { registerWithdrawals } from "../slices/withdrawalsSlice";
import { setPoolSyncedBlock } from "../slices/poolsSlice";
import { RootState } from "../store";
import {
  instanceRegistryInfoSelector,
  poolsSelector,
} from "../selectors/slices.selectors";
import { selectLastSyncedBlock } from "../selectors/last-synced-block.selector";

export interface SyncEventsThunkParams {
  syncService: ISyncService;
}

export const syncEventsThunk = createAsyncThunk<
  bigint,
  SyncEventsThunkParams,
  { state: RootState; }
>("sync/events", async ({ syncService }, { getState, dispatch }) => {
  const state = getState();
  const myPools = poolsSelector(state);
  const { chainId } = instanceRegistryInfoSelector(state);

  // Fetch each pool's events from its own last-synced block (falling back to the
  // block it was registered on). Per-pool because the external sync provider
  // serves data per pool, each with its own coverage.
  const results = await Promise.allSettled(
    Array.from(myPools.values()).map(async (pool) => {
      const events = await syncService.getPoolEvents({
        chainId,
        address: pool.address,
        fromBlock: pool.lastSyncedBlock ?? pool.registeredBlock,
      });

      return { ...events, pool: pool.address };
    }),
  );

  // Collect all events from successful results
  const allDeposits: IDepositEvent[] = [];
  const allWithdrawals: IWithdrawalEvent[] = [];
  // Start from the current global block so a run that syncs no pools never
  // regresses the value used for registry-level (relayer) syncing.
  let maxBlock = selectLastSyncedBlock(state);

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      const { Deposited, Withdrawn, toBlock, pool } = result.value;

      for (let dIndex = 0; dIndex < Deposited.length; dIndex++) {
        allDeposits.push({ ...Deposited[dIndex]!, pool });
      }

      for (let wIndex = 0; wIndex < Withdrawn.length; wIndex++) {
        allWithdrawals.push({ ...Withdrawn[wIndex]!, pool });
      }

      // Record how far this pool is now synced so the next sync resumes here.
      dispatch(setPoolSyncedBlock({ pool, block: toBlock }));

      if (toBlock > maxBlock) {
        maxBlock = toBlock;
      }
    }
  });

  // Register all fetched events
  if (allDeposits.length > 0) {
    dispatch(registerDeposits(allDeposits));
  }

  if (allWithdrawals.length > 0) {
    dispatch(registerWithdrawals(allWithdrawals));
  }

  // Return the highest block synced across all pools
  return maxBlock;
});
