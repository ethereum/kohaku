import { createAsyncThunk } from '@reduxjs/toolkit';

import { parseLegacyNote } from '../../account/legacyNote';
import { Address } from '../../interfaces/types.interface';
import { addLegacyUserSecret } from '../slices/legacySecretsSlice';
import { depositsSelector, instanceRegistryInfoSelector } from '../selectors/slices.selectors';
import { RootState } from '../store';

export interface ImportLegacyNotesThunkParams {
  notes: string[];
}

export type ImportNoteResult =
  | { note: string; status: 'imported'; poolAddress: Address }
  | { note: string; status: 'wrong-chain' }
  | { note: string; status: 'not-found' };

export const importLegacyNotesThunk = createAsyncThunk<
  ImportNoteResult[],
  ImportLegacyNotesThunkParams,
  { state: RootState }
>(
  'userSecrets/importLegacy',
  async ({ notes }, { getState, dispatch }) => {
    const state = getState();
    const deposits = depositsSelector(state);
    const { chainId } = instanceRegistryInfoSelector(state);

    return notes.map((note): ImportNoteResult => {
      const parsed = parseLegacyNote(note);

      if (parsed.chainId !== chainId) {
        return { note, status: 'wrong-chain' };
      }

      const matchedPool = [...deposits].find(([, poolDeposits]) => poolDeposits.has(parsed.commitment))?.[0];

      if (!matchedPool) {
        return { note, status: 'not-found' };
      }

      dispatch(addLegacyUserSecret({
        poolAddress: matchedPool,
        record: {
          commitment: parsed.commitment,
          nullifierHash: parsed.nullifierHash,
          nullifier: parsed.nullifier,
          salt: parsed.salt,
        },
      }));

      return { note, status: 'imported', poolAddress: matchedPool };
    });
  },
);
