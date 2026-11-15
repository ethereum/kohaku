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
  activePoolsSelector,
  instanceRegistryInfoSelector,
} from "../selectors/slices.selectors";
import { selectLastSyncedBlock } from "../selectors/last-synced-block.selector";
import { Address } from "../../interfaces/types.interface";
import { addressToHex } from "../../utils";

export interface SyncEventsThunkParams {
  syncService: ISyncService;
}

// Provider errors (viem's in particular) put the request URL on later lines, and
// hosted RPC URLs often embed an API key. Keep only the first line, capped, so the
// summary is safe to show in a wallet UI or log.
const MAX_REASON_LENGTH = 200;

function summarizeReason(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const firstLine = message.split("\n", 1)[0]!.trim() || "unknown error";

  return firstLine.length > MAX_REASON_LENGTH ? `${firstLine.slice(0, MAX_REASON_LENGTH)}…` : firstLine;
}

/**
 * Thrown when one or more pools could not be synced. Pools that did sync keep
 * their progress; the failed ones keep their previous cursor, so the next sync
 * retries exactly the range that failed. Only `name` and `message` survive the
 * worker and Redux boundaries, so the message carries the whole summary.
 */
export class TornadoPoolSyncError extends Error {
  constructor(failures: { pool: Address; reason: unknown }[], totalPools: number) {
    const pools = failures.map(({ pool }) => addressToHex(pool)).join(", ");
    const reasons = [...new Set(failures.map(({ reason }) => summarizeReason(reason)))].join(" | ");

    super(
      `Failed to sync events for ${failures.length} of ${totalPools} Tornado pools (${pools}): ${reasons}. ` +
      `Balances and notes may be incomplete until a sync succeeds; the next sync retries from each pool's last synced block.`,
    );
    this.name = "TornadoPoolSyncError";
  }
}

export const syncEventsThunk = createAsyncThunk<
  bigint,
  SyncEventsThunkParams,
  { state: RootState; }
>("sync/events", async ({ syncService }, { getState, dispatch }) => {
  const state = getState();
  const myPools = activePoolsSelector(state);
  const { chainId } = instanceRegistryInfoSelector(state);

  // Fetch each pool's events from its own last-synced block (falling back to the
  // block it was registered on). Per-pool because the external sync provider
  // serves data per pool, each with its own coverage.
  const pools = Array.from(myPools.values());
  const results = await Promise.allSettled(
    pools.map(async (pool) => {
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
  const failures: { pool: Address; reason: unknown }[] = [];

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failures.push({ pool: pools[index]!.address, reason: result.reason });
    } else {
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

  // Fail the sync after keeping the progress above. Returning normally here would
  // let `balance` and `prepareUnshield` report a missing pool's notes as zero, with
  // nothing telling the user or the wallet that the sync did not complete.
  if (failures.length > 0) {
    throw new TornadoPoolSyncError(failures, pools.length);
  }

  // Return the highest block synced across all pools
  return maxBlock;
});
