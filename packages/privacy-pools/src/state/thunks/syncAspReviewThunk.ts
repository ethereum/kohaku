import { createAsyncThunk } from '@reduxjs/toolkit';

import { IAspReviewService } from '../../data/asp.interface.js';
import { myDepositsBalanceSelector } from '../selectors/balance.selector';
import { entrypointInfoSelector, poolsSelector } from '../selectors/slices.selectors';
import { setAspFlaggedDeposits } from '../slices/aspReviewSlice';
import { RootState } from '../store';

export interface SyncAspReviewThunkParams {
  aspReviewService?: IAspReviewService;
}

/**
 * Refreshes which deposits the ASP flagged. It only asks when the user holds a
 * deposit outside the ASP tree, and never fails the sync: the review feed only
 * adds detail to `pending`, so on error the last list is kept.
 */
export const syncAspReviewThunk = createAsyncThunk<void, SyncAspReviewThunkParams, { state: RootState }>(
  'sync/aspReview',
  async ({ aspReviewService }, { getState, dispatch }) => {
    if (!aspReviewService) return;

    const state = getState();
    const hasUnresolved = Array.from(myDepositsBalanceSelector(state).values())
      .some((deposit) => !deposit.approved && deposit.balance > 0n);

    if (!hasUnresolved) return;

    const { chainId } = entrypointInfoSelector(state);
    const pools = poolsSelector(state);

    try {
      const flagged = await aspReviewService.getFlaggedDeposits({ chainId: BigInt(chainId) });

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
