import { createAsyncThunk } from "@reduxjs/toolkit";
import { ISyncService } from "../../data/interfaces/sync.service.interface";
import { IDataService } from "../../data/interfaces/data.service.interface";
import {
  IDepositEvent,
  IWithdrawalEvent,
} from "../../data/interfaces/events.interface";
import { registerDeposits } from "../slices/depositsSlice";
import { registerWithdrawals } from "../slices/withdrawalsSlice";
import { setPoolSyncedBlock } from "../slices/poolsSlice";
import { RootState } from "../store";
import {
  activePoolsSelector,
  depositsSelector,
  instanceRegistryInfoSelector,
} from "../selectors/slices.selectors";
import { selectLastSyncedBlock } from "../selectors/last-synced-block.selector";
import { verifyPoolLeavesAtBlock } from "../../verification/root-verification";

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

  // Fetch each pool's events from its own last-synced block (falling back to the
  // block it was registered on). Per-pool because the external sync provider
  // serves data per pool, each with its own coverage.
  const results = await Promise.allSettled(
    Array.from(myPools.values()).map(async (pool) => {
      const fromBlock = pool.lastSyncedBlock ?? pool.registeredBlock;
      const events = await syncService.getPoolEvents({
        chainId,
        address: pool.address,
        fromBlock,
      });

      return { ...events, fromBlock, pool: pool.address };
    }),
  );

  // Collect all events from successful results
  const allDeposits: IDepositEvent[] = [];
  const allWithdrawals: IWithdrawalEvent[] = [];
  // Start from the current global block so a run that syncs no pools never
  // regresses the value used for registry-level (relayer) syncing.
  let maxBlock = selectLastSyncedBlock(state);
  const storedDeposits = depositsSelector(state);
  const verificationErrors: Error[] = [];

  // Pools are checked one at a time: each check builds the pool's full tree.
  for (const result of results) {
    if (result.status === "fulfilled") {
      const { Deposited, Withdrawn, fromBlock, toBlock, pool } = result.value;

      // Whatever the source, a pool's events are only stored, and its cursor
      // only moved, once the tree they complete matches the Pool at `toBlock`.
      // An RPC behind the cursor scanned nothing, so there is nothing to check.
      if (toBlock >= fromBlock) {
        const deposits = new Map(storedDeposits.get(pool));

        Deposited.forEach((deposit) => deposits.set(deposit.commitment, { ...deposit, pool }));

        try {
          await verifyPoolLeavesAtBlock({
            dataService,
            poolAddress: pool,
            deposits: deposits.values(),
            blockNumber: toBlock,
          });
        } catch (error) {
          verificationErrors.push(error as Error);
          continue;
        }
      }

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
  }

  // Register all fetched events
  if (allDeposits.length > 0) {
    dispatch(registerDeposits(allDeposits));
  }

  if (allWithdrawals.length > 0) {
    dispatch(registerWithdrawals(allWithdrawals));
  }

  // Verified pools keep their progress; a failed pool is retried from its old
  // cursor next sync, and the sync fails so the mismatch is not reported as done.
  if (verificationErrors.length > 0) {
    throw new Error(verificationErrors.map(({ message }) => message).join("; "));
  }

  // Return the highest block synced across all pools
  return maxBlock;
});
