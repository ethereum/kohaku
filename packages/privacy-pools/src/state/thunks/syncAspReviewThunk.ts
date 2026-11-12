import { createAsyncThunk } from '@reduxjs/toolkit';

import { IAspReviewService } from '../../data/asp.interface.js';
import { aspFlaggedDepositsSelector, entrypointInfoSelector, poolsSelector } from '../selectors/slices.selectors';
import { setAspFlaggedDeposits } from '../slices/aspReviewSlice';
import { RootState } from '../store';
import { withTimeout } from '../utils/async.utils';

// Every sync waits for the feed, and a ragequit's sync queues behind a running
// one, so a feed that never answers must not hold them.
export const ASP_REVIEW_TIMEOUT_MS = 10_000;

export interface SyncAspReviewThunkParams {
  aspReviewService?: IAspReviewService;
}

/**
 * Refreshes which deposits the ASP flagged. It runs on the chain state, which
 * every account shares and which holds no account's notes, so it always asks
 * for the whole list. It never fails the sync: the review feed only adds detail
 * to `pending`, so on error or after ASP_REVIEW_TIMEOUT_MS the last list is kept.
 * Without a service the list is cleared, so labels fetched under an earlier
 * configuration don't stay forever.
 */
export const syncAspReviewThunk = createAsyncThunk<void, SyncAspReviewThunkParams, { state: RootState }>(
  'sync/aspReview',
  async ({ aspReviewService }, { getState, dispatch }) => {
    const state = getState();

    if (!aspReviewService) {
      if (aspFlaggedDepositsSelector(state).size > 0) dispatch(setAspFlaggedDeposits([]));

      return;
    }

    const { chainId } = entrypointInfoSelector(state);
    const pools = poolsSelector(state);

    try {
      const flagged = await withTimeout(ASP_REVIEW_TIMEOUT_MS, 'ASP review feed', (signal) =>
        aspReviewService.getFlaggedDeposits({ chainId: BigInt(chainId), signal }));

      dispatch(setAspFlaggedDeposits(
        flagged
          .filter(({ pool }) => pools.has(pool))
          .map(({ precommitment, status }) => [precommitment, status]),
      ));
    } catch (e) {
      console.warn('ASP review feed unavailable, keeping the last known review statuses', e);
    }
  }
);
