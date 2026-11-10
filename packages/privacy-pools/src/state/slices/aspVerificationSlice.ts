import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Serializable } from '../interfaces/utils.interface';
import { serialize } from '../utils/serialize.utils';

/**
 * The ASP root this session last matched against the Entrypoint's latestRoot()
 * (0n when none). Never persisted or dumped, so a stored state or a shared
 * snapshot cannot vouch for a root.
 */
export interface AspVerificationState {
  verifiedRoot: bigint;
}

type ActualAspVerificationState = Serializable<AspVerificationState>;

const initialState: ActualAspVerificationState = {
  verifiedRoot: '0',
};

export const aspVerificationSlice = createSlice({
  name: 'aspVerification',
  initialState,
  reducers: {
    setVerifiedAspRoot: (_state, { payload }: PayloadAction<bigint>) => {
      return serialize({ verifiedRoot: payload });
    },
  },
});

export const aspVerificationReducer = aspVerificationSlice.reducer;

export const { setVerifiedAspRoot } = aspVerificationSlice.actions;
