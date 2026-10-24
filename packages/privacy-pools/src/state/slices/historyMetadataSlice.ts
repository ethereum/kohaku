import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

/**
 * Exact per-event data that older versions fetched for the user's own events,
 * one block at a time. Still honored when present; no longer written.
 */
export interface HistoryEventMetadata {
  transactionHash: bigint;
  logIndex: number;
  timestamp: bigint;
}

export interface HistoryMetadataState {
  /**
   * Keyed by the event's unique id: precommitment (deposit),
   * spentNullifier (withdrawal) or label (ragequit).
   */
  metadataTuples: [bigint, HistoryEventMetadata][];
  /**
   * [blockNumber, timestamp] at every multiple of the timestamp grid plus the
   * last synced head (see syncHistoryTimestampsThunk). Absent in older states.
   */
  timestampAnchors?: [bigint, bigint][];
}

type ActualHistoryMetadataState = Serializable<HistoryMetadataState>;

const initialState: ActualHistoryMetadataState = {
  metadataTuples: [],
  timestampAnchors: [],
};

export const historyMetadataSlice = createSlice({
  name: 'historyMetadata',
  initialState,
  reducers: {
    /** Adds anchors; anchors off the grid (a previous head) are replaced. */
    registerTimestampAnchors: (
      state,
      { payload: { grid, anchors } }: PayloadAction<{ grid: bigint; anchors: [bigint, bigint][] }>,
    ) => {
      const newAnchors = new Map(
        (state.timestampAnchors ?? []).filter(([blockNumber]) => BigInt(blockNumber) % grid === 0n),
      );

      anchors.forEach(([blockNumber, timestamp]) => {
        newAnchors.set(serialize(blockNumber), serialize(timestamp));
      });

      state.timestampAnchors = Array.from(newAnchors);
    },
  },
});

export const { registerTimestampAnchors } = historyMetadataSlice.actions;
export const historyMetadataReducer = historyMetadataSlice.reducer;
