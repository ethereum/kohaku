import { createAsyncThunk } from "@reduxjs/toolkit";
import { IDataService } from "../../data/interfaces/data.service.interface";
import {
  IDepositEvent,
  IWithdrawalEvent,
} from "../../data/interfaces/events.interface";
import { selectLastSyncedBlock } from "../selectors/last-synced-block.selector";
import { registerDeposits } from "../slices/depositsSlice";
import { registerWithdrawals } from "../slices/withdrawalsSlice";
import { RootState } from "../store";
import { poolsSelector } from "../selectors/slices.selectors";

export interface SyncEventsThunkParams {
  dataService: IDataService;
}

export const syncEventsThunk = createAsyncThunk<
  bigint,
  SyncEventsThunkParams,
  { state: RootState; }
>("sync/events", async ({ dataService }, { getState, dispatch }) => {
  const state = getState();
  const myPools = poolsSelector(state);
  const lastSyncedBlock = selectLastSyncedBlock(state);

  // Fetch deposits, withdrawals, and ragequits from all pools in parallel
  const results = await Promise.allSettled(
    Array.from(myPools.values()).map(async (pool) => {
      const events = await dataService.getPoolEvents({
        events: ["Deposited", "Withdrawn"],
        fromBlock:
          lastSyncedBlock === 0n ? pool.registeredBlock : lastSyncedBlock,
        address: pool.address,
      });

      return {
        ...events,
        pool: pool.address,
      };
    }),
  );

  // Collect all events from successful results
  const allDeposits: IDepositEvent[] = [];
  const allWithdrawals: IWithdrawalEvent[] = [];
  let maxBlock = lastSyncedBlock;

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      const { Deposited, Withdrawn, toBlock, pool } =
        result.value;

      allDeposits.push(...Deposited.map((e) => ({ ...e, pool })));
      allWithdrawals.push(...Withdrawn.map((e) => ({ ...e, pool })));

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

  // Return the block number from the last event fetched
  return maxBlock;
});
