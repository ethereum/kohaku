import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Address } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { deserialize, serialize } from '../utils/serialize.utils';
import { LegacyUserSecretRecord } from './userSecretsSlice';

export interface LegacySecretsState {
  byPool: [Address, LegacyUserSecretRecord[]][];
}

type ActualLegacySecretsState = Serializable<LegacySecretsState>;

const initialState: ActualLegacySecretsState = {
  byPool: [],
};

export const legacySecretsSlice = createSlice({
  name: 'legacySecrets',
  initialState,
  reducers: {
    addLegacyUserSecret: (
      { byPool },
      { payload: { poolAddress, record } }: PayloadAction<{ poolAddress: Address; record: LegacyUserSecretRecord }>,
    ) => {
      const map = new Map(deserialize(byPool));
      const records = map.get(poolAddress) || [];

      if (!records.some((r) => r.commitment === record.commitment)) {
        records.push(record);
      }

      map.set(poolAddress, records);

      return serialize({ byPool: [...map] });
    },
  },
});

export const { addLegacyUserSecret } = legacySecretsSlice.actions;
export const legacySecretsReducer = legacySecretsSlice.reducer;
