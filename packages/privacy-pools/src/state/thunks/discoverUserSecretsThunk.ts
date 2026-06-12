import { createAsyncThunk } from '@reduxjs/toolkit';

import { ISecretManager } from '../../account/keys';
import { RootState } from '../store';
import {
  depositsSelector,
  entrypointInfoSelector,
  userSecretsSelector,
  withdrawalsSelector,
} from '../selectors/slices.selectors';
import { addNoteSecrets, addUserSecret, NoteSecretRecord } from '../slices/userSecretsSlice';
import { Precommitment } from '../../interfaces/types.interface';

export interface DiscoverUserSecretsThunkParams {
  secretManager: ISecretManager;
}

export const discoverUserSecretsThunk = createAsyncThunk<
  void,
  DiscoverUserSecretsThunkParams,
  { state: RootState }
>(
  'userSecrets/discover',
  async ({ secretManager }, { getState, dispatch }) => {
    const state = getState();
    const depositsMap = depositsSelector(state);
    const withdrawalsMap = withdrawalsSelector(state);
    const { chainId, entrypointAddress } = entrypointInfoSelector(state);

    // Phase 1: discover new deposits starting from the next unknown index
    const initialSecretsMap = userSecretsSelector(state);

    for (let depositIndex = initialSecretsMap.size; ; depositIndex++) {
      const s = await secretManager.getDepositSecrets({ entrypointAddress, chainId, depositIndex });

      if (!depositsMap.has(s.precommitment as Precommitment)) break;

      dispatch(addUserSecret({
        depositIndex,
        noteSecrets: [{ noteIndex: 0, ...s }],
      }));
    }

    // Phase 2: discover new withdrawal secrets for all known deposits (re-read after phase 1)
    for (const [precommitment, record] of userSecretsSelector(getState())) {
      const newNoteSecrets: NoteSecretRecord[] = [];
      let checkSecret: NoteSecretRecord | undefined = record.noteSecrets[record.noteSecrets.length - 1];

      for (let noteIndex = record.noteSecrets.length; ; noteIndex++) {
        if (!checkSecret || !withdrawalsMap.has(checkSecret.nullifierHash)) break;

        const next = await secretManager.getSecrets({
          entrypointAddress,
          chainId,
          depositIndex: record.depositIndex,
          withdrawIndex: noteIndex,
        });

        newNoteSecrets.push({ noteIndex, ...next });
        checkSecret = newNoteSecrets[newNoteSecrets.length - 1];
      }

      if (newNoteSecrets.length > 0) {
        dispatch(addNoteSecrets({ precommitment, noteSecrets: newNoteSecrets }));
      }
    }
  },
);
