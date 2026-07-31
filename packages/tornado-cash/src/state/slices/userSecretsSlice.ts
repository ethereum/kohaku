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

/**
 * A secret imported from a legacy (pre-SDK) Tornado Cash note. There is no
 * keystore-derived `depositIndex` for these — they were never derived from
 * our BIP32 path.
 */
export type LegacyUserSecretRecord = Omit<UserSecretRecord, 'depositIndex'>

export type UserSecretEntry =
  | ({ kind: 'derived' } & UserSecretRecord)
  | ({ kind: 'legacy' } & LegacyUserSecretRecord);

export interface UserSecretsState {
  byPool: [Address, UserSecretRecord[]][];
  legacyByPool: [Address, LegacyUserSecretRecord[]][];
}

type ActualUserSecretsState = Serializable<UserSecretsState>;

const initialState: ActualUserSecretsState = {
  byPool: [],
  legacyByPool: [],
};

export const userSecretsSlice = createSlice({
  name: 'userSecrets',
  initialState,
  reducers: {
    addUserSecret: (
      { byPool, legacyByPool },
      { payload: { poolAddress, record } }: PayloadAction<{ poolAddress: Address; record: UserSecretRecord }>,
    ) => {
      const map = new Map(deserialize(byPool));
      const records = map.get(poolAddress) || [];

      if (!records.some((r) => r.depositIndex === record.depositIndex)) {
        records.push(record);
      }

      map.set(poolAddress, records);

      return { ...serialize({ byPool: [...map]}), legacyByPool };
    },
    addLegacyUserSecret: (
      { byPool, legacyByPool },
      { payload: { poolAddress, record } }: PayloadAction<{ poolAddress: Address; record: LegacyUserSecretRecord }>,
    ) => {
      const map = new Map(deserialize(legacyByPool));
      const records = map.get(poolAddress) || [];

      if (!records.some((r) => r.commitment === record.commitment)) {
        records.push(record);
      }

      map.set(poolAddress, records);

      return { byPool, ...serialize({ legacyByPool: [...map] }) };
    },
  },
});

export const { addUserSecret, addLegacyUserSecret } = userSecretsSlice.actions;
export const userSecretsReducer = userSecretsSlice.reducer;
