import { createAsyncThunk, unwrapResult } from '@reduxjs/toolkit';
import { IDataService } from '../../data/interfaces/data.service.interface';
import { selectSyncCursor } from '../selectors/last-synced-block.selector';
import { RootState } from '../store';
import { registerEntrypointDeposits } from '../slices/entrypointDepositsSlice';
import { syncPoolsThunk, SyncPoolsThunkParams } from './syncPoolsThunk';
import { syncAssetsThunk, SyncAssetsThunkParams } from './syncAssetsThunk';
import { registerLastFinalizedUpdateRootEvent, registerLastUpdateRootEvent } from '../slices/updateRootEventsSlice';
import { isAspTreeCurrent, syncAspThunk, SyncAspThunkParams } from './syncAspThunk';
import { syncAspReviewThunk, SyncAspReviewThunkParams } from './syncAspReviewThunk';
import { pruneAfterBlock, setSyncedBlocks } from '../slices/syncSlice';
import { syncEventsThunk, SyncEventsThunkParams } from './syncEventsThunk';
import { entrypointInfoSelector, lastUpdateRootEventSelector } from '../selectors/slices.selectors';
import { verifyRootsThunk } from './verifyRootsThunk';

/**
 * How far below its saved head a state saved before the finalized cursor existed
 * is rescanned, once: about a day of mainnet blocks, far past any finality delay
 * seen, so whatever that head had not finalized yet is scanned again.
 */
export const LEGACY_REWIND_BLOCKS = 7200n;

// The saved head was never checked against finality: rewind below it, and never
// past what the chain has finalized now.
const legacySyncCursor = (state: RootState, finalizedBlock: bigint): bigint => {
  const { deploymentBlock } = entrypointInfoSelector(state);
  const rewound = BigInt(state.sync.lastSyncedBlock) - LEGACY_REWIND_BLOCKS;
  const cursor = rewound < finalizedBlock ? rewound : finalizedBlock;

  return cursor > deploymentBlock ? cursor : deploymentBlock;
};

export interface SyncThunkParams extends
  SyncEventsThunkParams,
  Omit<SyncPoolsThunkParams, 'poolsRegistered' | 'poolsWoundDown'>,
  SyncAssetsThunkParams,
  SyncAspThunkParams,
  SyncAspReviewThunkParams {
  dataService: IDataService;
  verify?: boolean;
  /** Leave the ASP service out of this sync, keeping the stored tree. */
  skipAsp?: boolean;
}

/**
 * Syncs everything that is the same for every account. An account finds its own
 * notes in the result with discoverUserSecretsThunk.
 */
export const syncThunk = createAsyncThunk<void, SyncThunkParams, { state: RootState; }>(
  'sync/syncEverything',
  async ({ dataService, verify = true, skipAsp = false, ...params }, { getState, dispatch }) => {
    const state = getState();
    const { entrypointAddress } = entrypointInfoSelector(state);
    // One head for the whole sync: the entrypoint and pool scans all stop at it, so
    // no block can fall between two scans.
    const [toBlock, chainFinalizedBlock] = await Promise.all([
      dataService.getBlockNumber(),
      dataService.getFinalizedBlockNumber(),
    ]);
    // A load-balanced RPC can answer from a node ahead of the head.
    const finalizedBlock = chainFinalizedBlock < toBlock ? chainFinalizedBlock : toBlock;
    const fromBlock = state.sync.finalizedBlock === undefined
      ? legacySyncCursor(state, finalizedBlock)
      : selectSyncCursor(state);

    // Blocks after the last finalized one may have been reorged away since they
    // were scanned, or come from a sync that failed: drop them and scan them again.
    dispatch(pruneAfterBlock(fromBlock));

    const {
      EntrypointDeposited,
      RootUpdated,
      PoolRegistered: poolsRegistered,
      PoolWindDown: poolsWoundDown
    } = await dataService.getEntrypointEvents({
      events: [
        "EntrypointDeposited",
        "RootUpdated",
        "PoolRegistered",
        "PoolWindDown"
      ],
      fromBlock,
      toBlock,
      address: entrypointAddress,
    });

    unwrapResult(await dispatch(syncPoolsThunk({
      poolsRegistered,
      poolsWoundDown,
    })));

    if (EntrypointDeposited.length > 0) {
      dispatch(registerEntrypointDeposits(EntrypointDeposited));
    }

    if (RootUpdated.length) {
      dispatch(registerLastUpdateRootEvent(RootUpdated.at(-1)!));
    }

    const lastFinalizedRootUpdated = RootUpdated.filter(({ blockNumber }) => blockNumber <= finalizedBlock).at(-1);

    if (lastFinalizedRootUpdated) {
      dispatch(registerLastFinalizedUpdateRootEvent(lastFinalizedRootUpdated));
    }

    unwrapResult(await dispatch(syncEventsThunk({ dataService, fromBlock, toBlock, ...params })));

    unwrapResult(await dispatch(syncAssetsThunk({ dataService, ...params })));

    if (!skipAsp) {
      // An unreachable or lying ASP service must not take the chain state down with
      // it: the last good tree stays, and the next sync tries again.
      const aspResult = await dispatch(syncAspThunk({ ...params }));

      if (syncAspThunk.rejected.match(aspResult)) {
        console.warn(`ASP sync failed, keeping the last good tree: ${aspResult.error.message}`);
      }

      unwrapResult(await dispatch(syncAspReviewThunk({ ...params })));
    }

    if (verify) {
      // A tree behind the last RootUpdated cannot match latestRoot(). Its check is
      // left out, so the verified root stays unset and withdrawals are refused.
      const hasRootEvent = lastUpdateRootEventSelector(getState()) !== undefined;
      const verifyAspRoot = !hasRootEvent || await isAspTreeCurrent(getState(), params.merkleTreeBuilder);
      // An RPC behind our sync point scanned nothing and cannot serve the pool
      // roots there either. The sync point does not move, so the pools are checked
      // by the first sync that scans past it.
      const verifyResult = await dispatch(verifyRootsThunk({
        dataService,
        blockNumber: toBlock,
        verifyAspRoot,
        verifyPoolRoots: toBlock > fromBlock,
        merkleTreeBuilder: params.merkleTreeBuilder,
      }));

      unwrapResult(verifyResult);
    }

    // An RPC behind our sync point scans nothing; keep the point where it is.
    if (toBlock > fromBlock) {
      dispatch(setSyncedBlocks({
        head: toBlock,
        finalized: finalizedBlock > fromBlock ? finalizedBlock : fromBlock,
      }));
    }
  }
);
