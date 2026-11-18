import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IRagequitEvent } from '../../data/interfaces/events.interface';
import { Label } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { keepUpToBlock } from '../utils/prune.utils';
import { serialize } from '../utils/serialize.utils';
import { pruneAfterBlock } from './syncSlice';

export interface RagequitsState {
  ragequitsTuples: [Label, IRagequitEvent][];
}

type ActualRagequitsState = Serializable<RagequitsState>;

const initialState: ActualRagequitsState = {
  ragequitsTuples: [],
};

export const ragequitsSlice = createSlice({
  name: 'ragequits',
  initialState,
  reducers: {
    registerRagequits: ({ ragequitsTuples }, action: PayloadAction<IRagequitEvent[]>) => {
      const newRagequits = new Map(ragequitsTuples);

      action.payload.forEach((ragequit) => {
        const key = ragequit.label;

        newRagequits.set(serialize(key), serialize(ragequit));
      });

      return { ragequitsTuples: Array.from(newRagequits) };
    },
  },
  extraReducers: (builder) => {
    builder.addCase(pruneAfterBlock, ({ ragequitsTuples }, { payload: block }) => ({
      ragequitsTuples: keepUpToBlock(ragequitsTuples, block),
    }));
  },
});

export const { registerRagequits } = ragequitsSlice.actions;
export const ragequitsReducer = ragequitsSlice.reducer;
