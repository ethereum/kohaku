import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

/**
 * Per-event data that sync sources (saga) don't provide, fetched on demand
 * only for the user's own events.
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
}

type ActualHistoryMetadataState = Serializable<HistoryMetadataState>;

const initialState: ActualHistoryMetadataState = {
  metadataTuples: [],
};

export const historyMetadataSlice = createSlice({
  name: 'historyMetadata',
  initialState,
  reducers: {
    registerHistoryMetadata: (
      { metadataTuples },
      { payload }: PayloadAction<[bigint, HistoryEventMetadata][]>,
    ) => {
      const newMetadata = new Map(metadataTuples);

      payload.forEach(([eventId, metadata]) => {
        newMetadata.set(serialize(eventId), serialize(metadata));
      });

      return { metadataTuples: Array.from(newMetadata) };
    },
  },
});

export const { registerHistoryMetadata } = historyMetadataSlice.actions;
export const historyMetadataReducer = historyMetadataSlice.reducer;
