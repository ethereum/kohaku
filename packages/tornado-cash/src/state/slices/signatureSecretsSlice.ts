import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Address, Commitment, Nullifier, NullifierHash } from '../../interfaces/types.interface';
import { Serializable } from '../interfaces/utils.interface';
import { deserialize, serialize } from '../utils/serialize.utils';

export interface SignatureUserSecretRecord {
  commitment: Commitment;
  nullifierHash: NullifierHash;
  nullifier: Nullifier;
  salt: bigint;
  nonce: number;
}

export interface SignatureSecretsState {
  byPool: [Address, SignatureUserSecretRecord[]][];
}

type ActualSignatureSecretsState = Serializable<SignatureSecretsState>;

const initialState: ActualSignatureSecretsState = {
  byPool: [],
};

export const signatureSecretsSlice = createSlice({
  name: 'signatureSecrets',
  initialState,
  reducers: {
    addSignatureSecret: (
      { byPool },
      { payload: { poolAddress, record } }: PayloadAction<{ poolAddress: Address; record: SignatureUserSecretRecord }>,
    ) => {
      const map = new Map(deserialize(byPool));
      const records = map.get(poolAddress) || [];

      if (!records.some((r) => r.nonce === record.nonce)) {
        records.push(record);
      }

      map.set(poolAddress, records);

      return serialize({ byPool: [...map] });
    },
  },
});

export const { addSignatureSecret } = signatureSecretsSlice.actions;
export const signatureSecretsReducer = signatureSecretsSlice.reducer;
