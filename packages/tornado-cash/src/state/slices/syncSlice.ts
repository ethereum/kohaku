import { createAction, createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Address } from '../../interfaces/types.interface';
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

/**
 * Drops `pool`'s deposits and withdrawals from `block` on, for a rescan from
 * there. Block 0 drops all of them.
 */
export const prunePoolFromBlock = createAction<{ pool: Address; block: bigint }>('sync/prunePoolFromBlock');

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
