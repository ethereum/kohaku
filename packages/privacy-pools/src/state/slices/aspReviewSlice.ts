import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { AspFlaggedStatus } from '../../data/asp.interface';
import { Precommitment } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

/**
 * The chain's deposits the ASP review feed flagged, for this entrypoint's pools.
 * Public data, so it is part of dumps like the ASP tree.
 */
export interface AspReviewState {
  flaggedTuples: [Precommitment, AspFlaggedStatus][];
}

type ActualAspReviewState = Serializable<AspReviewState>;

const initialState: ActualAspReviewState = {
  flaggedTuples: [],
};

export const aspReviewSlice = createSlice({
  name: 'aspReview',
  initialState,
  reducers: {
    // Replaces the list: a decline the ASP reverted must drop out.
    setAspFlaggedDeposits: (_state, { payload }: PayloadAction<[Precommitment, AspFlaggedStatus][]>) => {
      return { flaggedTuples: Array.from(new Map(serialize(payload))) };
    },
  },
});

export const aspReviewReducer = aspReviewSlice.reducer;

export const { setAspFlaggedDeposits } = aspReviewSlice.actions;
