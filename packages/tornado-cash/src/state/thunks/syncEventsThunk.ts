import { createAsyncThunk } from "@reduxjs/toolkit";
import { ISyncService } from "../../data/interfaces/sync.service.interface";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { IDepositEvent, IPool } from "../../data/interfaces/events.interface";
import { Address, Commitment } from "../../interfaces/types.interface";
import { addressToHex } from "../../utils";
import { PoolVerificationError, verifyPoolLeavesAt } from "../../verification/root-verification";
import { registerDeposits } from "../slices/depositsSlice";
import { registerWithdrawals } from "../slices/withdrawalsSlice";
import { registerPools, setPoolSyncedBlocks } from "../slices/poolsSlice";
import { prunePoolFromBlock } from "../slices/syncSlice";
import { RootState } from "../store";
import {
  activePoolsSelector,
  depositsSelector,
  instanceRegistryInfoSelector,
  withdrawalsSelector,
} from "../selectors/slices.selectors";
import { selectLastSyncedBlock } from "../selectors/last-synced-block.selector";

/**
 * How far below its saved head a pool saved before the finalized cursor existed
 * is rescanned, once: about a day of mainnet blocks, far past any finality delay
 * seen, so whatever that head had not finalized yet is scanned again.
 */
export const LEGACY_REWIND_BLOCKS = 7200n;

export interface SyncEventsThunkParams {
  syncService: ISyncService;
  dataService: IDataService;
}

interface PoolScan {
  fromBlock: bigint;
  /** Skip the external sync provider, after it served events that failed verification. */
  chainOnly: boolean;
  /** Replay the pool from its deployment block, dropping everything stored for it. */
  reset: boolean;
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

/** The RPC answered from a node behind the saved cursor: nothing new, and nothing lost. */
class PoolScanBehindError extends Error {}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

// The saved head was never checked against finality: rewind below it, and never
// past what the chain has finalized now.
const legacyCursor = (pool: IPool, lastSyncedBlock: bigint, finalizedBlock: bigint): bigint =>
  max(min(lastSyncedBlock - LEGACY_REWIND_BLOCKS, finalizedBlock), pool.registeredBlock);

export const syncEventsThunk = createAsyncThunk<
  bigint,
  SyncEventsThunkParams,
  { state: RootState; }
>("sync/events", async ({ syncService, dataService }, { getState, dispatch }) => {
  const state = getState();
  const myPools = activePoolsSelector(state);
  const storedDeposits = depositsSelector(state);
  const latestStoredBlock = new Map<Address, bigint>();

  for (const [address, deposits] of storedDeposits) {
    for (const { blockNumber } of deposits.values()) {
      latestStoredBlock.set(address, max(latestStoredBlock.get(address) ?? 0n, blockNumber));
    }
  }

  for (const { pool, blockNumber } of withdrawalsSelector(state).values()) {
    latestStoredBlock.set(pool, max(latestStoredBlock.get(pool) ?? 0n, blockNumber));
  }

  const { chainId } = instanceRegistryInfoSelector(state);
  const [head, chainFinalizedBlock] = myPools.size > 0
    ? await Promise.all([dataService.getBlockNumber(), dataService.getFinalizedBlockNumber()])
    : [0n, 0n];
  // A load-balanced RPC can answer from a node ahead of the head.
  const finalizedBlock = min(chainFinalizedBlock, head);

  const scanPool = async (pool: IPool, { fromBlock, chainOnly, reset }: PoolScan) => {
    const events = await syncService.getPoolEvents({ chainId, address: pool.address, fromBlock, chainOnly });

    // Never replace saved events with a scan that has not reached their blocks.
    if (events.toBlock < fromBlock || events.toBlock < (latestStoredBlock.get(pool.address) ?? 0n)) {
      throw new PoolScanBehindError('Pool log scan is behind the saved cursor');
    }

    const stored = storedDeposits.get(pool.address) ?? new Map<Commitment, IDepositEvent>();
    // The tree after this sync: what is kept below `fromBlock`, plus the rescan.
    const deposits = new Map(reset ? [] : [...stored].filter(([, { blockNumber }]) => blockNumber < fromBlock));
    // The saved frontier covers exactly what the last sync kept below its finalized block.
    const frontier = !reset && pool.frontier?.size === deposits.size ? pool.frontier : undefined;
    const finalized = max(min(finalizedBlock, events.toBlock), fromBlock);

    events.Deposited.forEach((deposit) => deposits.set(deposit.commitment, { ...deposit, pool: pool.address }));

    try {
      const verified = await verifyPoolLeavesAt({
        dataService,
        poolAddress: pool.address,
        deposits: deposits.values(),
        blockNumber: events.toBlock,
        frontier,
        frontierBlock: finalized,
      });

      return { ...events, ...verified, finalized, fromBlock, reset, mismatch: undefined };
    } catch (error) {
      // Transport errors fail the pool for this sync; only a mismatch is retried.
      if (!(error instanceof PoolVerificationError)) throw error;

      return { ...events, mismatch: error };
    }
  };

  // Each pool is scanned from its own finalized cursor (or its registered block).
  // Per-pool because the external sync provider serves data per pool, each with
  // its own coverage. Nothing is stored until the pool's rebuilt tree matches the
  // chain at the scanned head; a mismatch retries without the external provider,
  // then replays the pool from deployment, in case its stored deposits are bad.
  const pools = Array.from(myPools.values());
  const results = await Promise.allSettled(
    pools.map(async (pool) => {
      const saved = pool.finalizedBlock ?? pool.lastSyncedBlock;
      const resetScan = async (chainOnly: boolean): Promise<PoolScan> => ({
        fromBlock: await syncService.getPoolDeploymentBlock({ chainId, address: pool.address }),
        chainOnly,
        reset: true,
      });

      // An impossible saved cursor must replay history, not be clamped to the head.
      let scan: PoolScan = saved !== undefined && (saved < pool.registeredBlock || saved > head)
        ? await resetScan(false)
        : {
          fromBlock: pool.finalizedBlock ?? (
            pool.lastSyncedBlock === undefined
              ? pool.registeredBlock
              : legacyCursor(pool, pool.lastSyncedBlock, finalizedBlock)
          ),
          chainOnly: false,
          reset: false,
        };

      for (;;) {
        const scanned = await scanPool(pool, scan);

        if (scanned.mismatch === undefined) return { ...scanned, pool };

        if (scan.reset && !scanned.external) throw scanned.mismatch;

        console.warn(`Pool ${addressToHex(pool.address)} failed verification, rescanning: ${scanned.mismatch.message}`);
        // Events the provider served are retried from the chain alone; a chain
        // scan that still fails points at the stored deposits, so replay the pool.
        scan = scanned.external ? { ...scan, chainOnly: true } : await resetScan(true);
      }
    }),
  );

  // Start from the current global block so a run that syncs no pools never
  // regresses the value used for registry-level (relayer) syncing.
  let maxBlock = selectLastSyncedBlock(state);
  const verificationErrors: PoolVerificationError[] = [];
  const failures: { pool: Address; reason: unknown }[] = [];

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn('Failed to sync pool events', result.reason);

      if (result.reason instanceof PoolVerificationError) verificationErrors.push(result.reason);
      // A lagging node keeps the pool's saved events and cursor as they were.
      else if (!(result.reason instanceof PoolScanBehindError)) failures.push({ pool: pools[index]!.address, reason: result.reason });

      return;
    }

    const { Deposited, Withdrawn, toBlock, root, frontier, finalized, fromBlock, reset, pool } = result.value;

    // Replace everything from `fromBlock` on: a reorg may have dropped it since.
    dispatch(prunePoolFromBlock({ pool: pool.address, block: reset ? 0n : fromBlock }));
    dispatch(registerDeposits(Deposited.map((deposit) => ({ ...deposit, pool: pool.address }))));
    dispatch(registerWithdrawals(Withdrawn.map((withdrawal) => ({ ...withdrawal, pool: pool.address }))));

    if (reset) dispatch(registerPools([{ ...pool, registeredBlock: fromBlock }]));

    // Record how far this pool is now synced so the next sync resumes here.
    dispatch(setPoolSyncedBlocks({ pool: pool.address, head: toBlock, finalized, verifiedRoot: root, frontier }));

    if (toBlock > maxBlock) {
      maxBlock = toBlock;
    }
  });

  // Keep verified pools' progress, but do not report the sync as complete when
  // another pool still fails verification after the chain replay.
  if (verificationErrors.length > 0) {
    throw new Error(verificationErrors.map(({ message }) => message).join('; '));
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
