import { createAsyncThunk } from "@reduxjs/toolkit";
import { poseidon } from "maci-crypto/build/ts/hashing.js";
import { IDataService } from "../../data/interfaces/data.service.interface";
import {
  ILeafInsertedEvent,
  IRawPoolDepositEvent,
  IPoolDepositEvent,
  IWithdrawalEvent,
  IRagequitEvent,
} from "../../data/interfaces/events.interface";
import { Address } from "../../interfaces/types.interface";
import { registerDeposits } from "../slices/depositsSlice";
import { registerRagequits } from "../slices/ragequitsSlice";
import { registerWithdrawals } from "../slices/withdrawalsSlice";
import { RootState } from "../store";
import { poolsSelector } from "../selectors/slices.selectors";
import { registerPoolLeaves } from "../slices/poolLeavesSlice";

const POOL_SYNC_BATCH_SIZE = 4;

/**
 * A deposit's leaf is inserted in the same transaction, so it comes in the same
 * scan. Only the leaves are root-checked: a deposit must hash to one of them, or
 * its value, label and precommitment are only what the source claimed.
 */
const assertDepositsBound = (deposits: IRawPoolDepositEvent[], leaves: ILeafInsertedEvent[], pool: Address) => {
  const leafCommitments = new Set(leaves.map(({ commitment }) => commitment));

  for (const { commitment, value, label, precommitment } of deposits) {
    if (poseidon([value, label, precommitment]) !== commitment) {
      throw new Error(`Pool ${pool} deposit ${commitment} does not match its value, label and precommitment`);
    }

    if (!leafCommitments.has(commitment)) {
      throw new Error(`Pool ${pool} deposit ${commitment} has no inserted leaf`);
    }
  }
};

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

    // Checked before this batch registers anything, so a bad one registers none of it.
    for (const { PoolDeposited, LeafInserted, pool } of results) {
      assertDepositsBound(PoolDeposited, LeafInserted, pool);
    }

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
