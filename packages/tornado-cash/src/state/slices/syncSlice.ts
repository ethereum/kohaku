import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface SyncState {
  lastSyncedBlock: bigint;
  /** Highest block the relayer registry has been synced to. */
  relayerRegistrySyncedBlock: bigint;
}

type ActualSyncState = Serializable<SyncState>;

const initialState: ActualSyncState = {
  lastSyncedBlock: '0',
  relayerRegistrySyncedBlock: '0',
};

export const syncSlice = createSlice({
  name: 'sync',
  initialState,
  reducers: {
    setLastSyncedBlock: (state, { payload }: PayloadAction<bigint>) => ({
      ...state,
      lastSyncedBlock: serialize(payload),
    }),
    setRelayerRegistrySyncedBlock: (state, { payload }: PayloadAction<bigint>) => ({
      ...state,
      relayerRegistrySyncedBlock: serialize(payload),
    }),
  },
});

export const { setLastSyncedBlock, setRelayerRegistrySyncedBlock } = syncSlice.actions;
export const syncReducer = syncSlice.reducer;
