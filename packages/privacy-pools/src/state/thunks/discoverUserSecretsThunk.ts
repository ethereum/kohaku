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

    // Phase 1: follow the sequence from zero and the one after each known index.
    // Gaps stay unsearched, so a sparse index must be registered explicitly.
    const initialSecretsMap = userSecretsSelector(state);

    const knownIndexes = new Set(
      [...initialSecretsMap.values()].map(record => record.depositIndex)
    );

    const starts = [...new Set([0, ...[...knownIndexes].map(index => index + 1)])]
      .filter(index => Number.isSafeInteger(index) && index >= 0 && !knownIndexes.has(index));

    for (const start of starts) {
      for (
        let depositIndex = start;
        Number.isSafeInteger(depositIndex) && !knownIndexes.has(depositIndex);
        depositIndex++
      ) {
        const s = await secretManager.getDepositSecrets({ entrypointAddress, chainId, depositIndex });

        if (!depositsMap.has(s.precommitment as Precommitment)) break;

        dispatch(addUserSecret({
          depositIndex,
          noteSecrets: [{ noteIndex: 0, ...s }],
        }));
        knownIndexes.add(depositIndex);
      }
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
