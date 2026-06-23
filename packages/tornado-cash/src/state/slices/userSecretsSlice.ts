import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Address, Commitment, Nullifier, NullifierHash } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { deserialize, serialize } from '../utils/serialize.utils';

export interface UserSecretRecord {
  commitment: Commitment;
  nullifierHash: NullifierHash;
  nullifier: Nullifier;
  salt: bigint;
  depositIndex: number;
}

export interface UserSecretsState {
  byPool: [Address, UserSecretRecord[]][];
}

type ActualUserSecretsState = Serializable<UserSecretsState>;

const initialState: ActualUserSecretsState = {
  byPool: [],
};

export const userSecretsSlice = createSlice({
  name: 'userSecrets',
  initialState,
  reducers: {
    addUserSecret: (
      { byPool },
      { payload: { poolAddress, record } }: PayloadAction<{ poolAddress: Address; record: UserSecretRecord }>,
    ) => {
      const map = new Map(deserialize(byPool));
      const records = map.get(poolAddress) || [];

      if (!records.some((r) => r.depositIndex === record.depositIndex)) {
        records.push(record);
      }

      map.set(poolAddress, records);

      return serialize({ byPool: [...map] });
    },
  },
});

export const { addUserSecret } = userSecretsSlice.actions;
export const userSecretsReducer = userSecretsSlice.reducer;
