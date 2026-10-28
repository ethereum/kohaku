import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Precommitment } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { deserialize, serialize } from '../utils/serialize.utils';

export interface NoteSecretRecord {
  noteIndex: number;
  nullifier: bigint;
  salt: bigint;
  precommitment: bigint;
  nullifierHash: bigint;
}

export interface UserSecretRecord {
  depositIndex: number;
  noteSecrets: NoteSecretRecord[];
  // noteSecrets[0]   = deposit secret (secretIndex=0)
  // noteSecrets[N]   = current spendable note after N withdrawals
  // noteSecrets.length - 1 = number of withdrawals from this deposit
}

export interface UserSecretsState {
  recordsByPrecommitment: [Precommitment, UserSecretRecord][];
}

type ActualUserSecretsState = Serializable<UserSecretsState>;

const initialState: ActualUserSecretsState = {
  recordsByPrecommitment: [],
};

export const userSecretsSlice = createSlice({
  name: 'userSecrets',
  initialState,
  reducers: {
    addUserSecret: (
      { recordsByPrecommitment },
      { payload: record }: PayloadAction<UserSecretRecord>,
    ) => {
      const map = new Map<Precommitment, UserSecretRecord>(
        deserialize(recordsByPrecommitment) as [Precommitment, UserSecretRecord][],
      );
      const depositSecret = record.noteSecrets[0];

      if (!depositSecret) return;

      const precommitment = depositSecret.precommitment as Precommitment;

      if (!map.has(precommitment)) {
        map.set(precommitment, record);
      }

      return serialize({ recordsByPrecommitment: [...map] });
    },
    addNoteSecrets: (
      { recordsByPrecommitment },
      { payload: { precommitment, noteSecrets } }: PayloadAction<{ precommitment: Precommitment; noteSecrets: NoteSecretRecord[] }>,
    ) => {
      const map = new Map<Precommitment, UserSecretRecord>(
        deserialize(recordsByPrecommitment) as [Precommitment, UserSecretRecord][],
      );
      const record = map.get(precommitment);

      if (record) {
        // Discovery derives notes by position, so a note index already held must
        // never be appended again: it would shift every later index by one.
        const knownIndexes = new Set(record.noteSecrets.map(({ noteIndex }) => noteIndex));
        const newNoteSecrets = noteSecrets.filter(({ noteIndex }) => !knownIndexes.has(noteIndex));

        map.set(precommitment, { ...record, noteSecrets: [...record.noteSecrets, ...newNoteSecrets] });
      }

      return serialize({ recordsByPrecommitment: [...map] });
    },
  },
});

export const { addUserSecret, addNoteSecrets } = userSecretsSlice.actions;
export const userSecretsReducer = userSecretsSlice.reducer;
