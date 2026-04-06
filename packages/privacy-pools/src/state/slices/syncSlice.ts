import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface SyncState {
  lastSyncedBlock: bigint;
}

type ActualSyncState = Serializable<SyncState>;

const initialState: ActualSyncState = {
  lastSyncedBlock: '0',
};

export const syncSlice = createSlice({
  name: 'sync',
  initialState,
  reducers: {
    setLastSyncedBlock: (state, { payload }: PayloadAction<bigint>) => {
      return serialize({
        lastSyncedBlock: payload,
      });
    },
  },
});

export const { setLastSyncedBlock } = syncSlice.actions;
export const syncReducer = syncSlice.reducer;
