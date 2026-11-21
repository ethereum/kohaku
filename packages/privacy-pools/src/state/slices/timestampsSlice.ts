import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface TimestampsState {
  /**
   * [blockNumber, timestamp] at every multiple of the timestamp grid plus the
   * last synced head (see syncHistoryTimestampsThunk). The same for every account.
   */
  anchors: [bigint, bigint][];
}

type ActualTimestampsState = Serializable<TimestampsState>;

const initialState: ActualTimestampsState = {
  anchors: [],
};

export const timestampsSlice = createSlice({
  name: 'timestamps',
  initialState,
  reducers: {
    /** Adds anchors; anchors off the grid (a previous head) are replaced. */
    registerTimestampAnchors: (
      state,
      { payload: { grid, anchors } }: PayloadAction<{ grid: bigint; anchors: [bigint, bigint][] }>,
    ) => {
      const newAnchors = new Map(
        state.anchors.filter(([blockNumber]) => BigInt(blockNumber) % grid === 0n),
      );

      anchors.forEach(([blockNumber, timestamp]) => {
        newAnchors.set(serialize(blockNumber), serialize(timestamp));
      });

      state.anchors = Array.from(newAnchors);
    },
  },
});

export const { registerTimestampAnchors } = timestampsSlice.actions;
export const timestampsReducer = timestampsSlice.reducer;
