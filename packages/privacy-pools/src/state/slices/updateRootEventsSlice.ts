import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IRootUpdatedEvent } from '../../data/interfaces/events.interface';
import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

export interface UpdateRootEventsState {
  lastUpdateRootEvent: IRootUpdatedEvent | null;
}

type ActualUpdateRootEventsState = Serializable<UpdateRootEventsState>;

const initialState: ActualUpdateRootEventsState = {
  lastUpdateRootEvent: null,
};

export const updateRootEventsSlice = createSlice({
  name: 'updateRootEvents',
  initialState,
  reducers: {
    registerLastUpdateRootEvent: (state, { payload }: PayloadAction<IRootUpdatedEvent>) => {
      return serialize({
        lastUpdateRootEvent: payload,
      });
    },
  },
});

export const { registerLastUpdateRootEvent } = updateRootEventsSlice.actions;
export const updateRootEventsReducer = updateRootEventsSlice.reducer;
