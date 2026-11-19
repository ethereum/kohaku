import { createAsyncThunk } from "@reduxjs/toolkit";
import { ISyncService } from "../../data/interfaces/sync.service.interface";
import { IDataService } from "../../data/interfaces/data.service.interface";
import {
  IDepositEvent,
  IWithdrawalEvent,
} from "../../data/interfaces/events.interface";
import { registerDeposits } from "../slices/depositsSlice";
import { registerWithdrawals } from "../slices/withdrawalsSlice";
import { registerPools, setPoolSyncedBlock } from "../slices/poolsSlice";
import { RootState } from "../store";
import {
  activePoolsSelector,
  instanceRegistryInfoSelector,
} from "../selectors/slices.selectors";
import { selectLastSyncedBlock } from "../selectors/last-synced-block.selector";

export interface SyncEventsThunkParams {
  syncService: ISyncService;
  dataService: IDataService;
}

export const syncEventsThunk = createAsyncThunk<
  bigint,
  SyncEventsThunkParams,
  { state: RootState; }
>("sync/events", async ({ syncService, dataService }, { getState, dispatch }) => {
  const state = getState();
  const myPools = activePoolsSelector(state);
  const { chainId } = instanceRegistryInfoSelector(state);
  const head = myPools.size > 0 ? await dataService.getBlockNumber() : 0n;

  // Fetch each pool's events from its own last-synced block (falling back to the
  // block it was registered on). Per-pool because the external sync provider
  // serves data per pool, each with its own coverage.
  const results = await Promise.allSettled(
    Array.from(myPools.values()).map(async (pool) => {
      let fromBlock = pool.lastSyncedBlock ?? pool.registeredBlock;
      const reset = fromBlock < pool.registeredBlock || fromBlock > head;

      // An impossible saved cursor must replay history, not be clamped to the head.
      if (reset) fromBlock = await syncService.getPoolDeploymentBlock({ chainId, address: pool.address });

      const events = await syncService.getPoolEvents({
        chainId,
        address: pool.address,
        fromBlock,
      });

      return { ...events, pool: pool.address, registeredBlock: reset ? fromBlock : undefined };
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
      const { Deposited, Withdrawn, toBlock, pool, registeredBlock } = result.value;

      for (let dIndex = 0; dIndex < Deposited.length; dIndex++) {
        allDeposits.push({ ...Deposited[dIndex]!, pool });
      }

      for (let wIndex = 0; wIndex < Withdrawn.length; wIndex++) {
        allWithdrawals.push({ ...Withdrawn[wIndex]!, pool });
      }

      // Record how far this pool is now synced so the next sync resumes here.
      if (registeredBlock !== undefined) dispatch(registerPools([{ ...myPools.get(pool)!, registeredBlock }]));

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
