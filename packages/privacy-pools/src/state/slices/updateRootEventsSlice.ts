import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IRootUpdatedEvent } from '../../data/interfaces/events.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';
import { pruneAfterBlock } from './syncSlice';

export interface UpdateRootEventsState {
  lastUpdateRootEvent: IRootUpdatedEvent | null;
  /**
   * The last RootUpdated from a finalized block: what lastUpdateRootEvent falls
   * back to when a rescan drops a later one. Absent in states saved before it existed.
   */
  lastFinalizedUpdateRootEvent?: IRootUpdatedEvent | null;
}

type ActualUpdateRootEventsState = Serializable<UpdateRootEventsState>;

const initialState: ActualUpdateRootEventsState = {
  lastUpdateRootEvent: null,
  lastFinalizedUpdateRootEvent: null,
};

export const updateRootEventsSlice = createSlice({
  name: 'updateRootEvents',
  initialState,
  reducers: {
    registerLastUpdateRootEvent: (state, { payload }: PayloadAction<IRootUpdatedEvent>) => {
      state.lastUpdateRootEvent = serialize(payload);
    },
    registerLastFinalizedUpdateRootEvent: (state, { payload }: PayloadAction<IRootUpdatedEvent>) => {
      state.lastFinalizedUpdateRootEvent = serialize(payload);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(pruneAfterBlock, (state, { payload: block }) => {
      const { lastUpdateRootEvent, lastFinalizedUpdateRootEvent = null } = state;

      if (lastUpdateRootEvent && BigInt(lastUpdateRootEvent.blockNumber) > block) {
        state.lastUpdateRootEvent = lastFinalizedUpdateRootEvent;
      }
    });
  },
});

export const { registerLastUpdateRootEvent, registerLastFinalizedUpdateRootEvent } = updateRootEventsSlice.actions;
export const updateRootEventsReducer = updateRootEventsSlice.reducer;
