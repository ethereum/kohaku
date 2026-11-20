import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface SignatureNoncesState {
  /**
   * First signature nonce no deposit payload has handed out. Discovery scans
   * every nonce below it, so a mined deposit from a partly submitted batch is
   * found however far it sits past the last discovered one.
   */
  nextNonce: number;
}

const initialState: SignatureNoncesState = {
  nextNonce: 0,
};

export const signatureNoncesSlice = createSlice({
  name: 'signatureNonces',
  initialState,
  reducers: {
    reserveSignatureNonces: (state, { payload: nextNonce }: PayloadAction<number>) => {
      if (nextNonce > state.nextNonce) state.nextNonce = nextNonce;
    },
  },
});

export const { reserveSignatureNonces } = signatureNoncesSlice.actions;
export const signatureNoncesReducer = signatureNoncesSlice.reducer;
