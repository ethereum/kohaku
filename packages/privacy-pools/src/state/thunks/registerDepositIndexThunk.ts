import { unwrapResult } from '@reduxjs/toolkit';
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import { ISecretManager } from '../../account/keys';
import { Precommitment } from '../../interfaces/types.interface';
import {
  depositsSelector,
  entrypointInfoSelector,
  userSecretsSelector,
} from '../selectors/slices.selectors';
import { addUserSecret } from '../slices/userSecretsSlice';
import { RootState } from '../store';
import { discoverUserSecretsThunk } from './discoverUserSecretsThunk';

interface RegisterDepositIndexParams {
  depositIndex: number;
  secretManager: ISecretManager;
}

type RegisterDepositIndexThunk = ThunkAction<
  Promise<boolean>,
  RootState,
  unknown,
  UnknownAction
>;

export const registerDepositIndexThunk = (
  { depositIndex, secretManager }: RegisterDepositIndexParams,
): RegisterDepositIndexThunk => async (dispatch, getState) => {
    const state = getState();
    const { chainId, entrypointAddress } = entrypointInfoSelector(state);

    const secret = await secretManager.getDepositSecrets({
      chainId,
      entrypointAddress,
      depositIndex,
    });
    const precommitment = secret.precommitment as Precommitment;

    if (!depositsSelector(state).has(precommitment)) {
      return false;
    }

    const known = userSecretsSelector(state);

    for (const [key, record] of known) {
      if (record.depositIndex === depositIndex && key !== precommitment) {
        throw new Error('Deposit index already registered');
      }
    }

    const existing = known.get(precommitment);

    if (existing && existing.depositIndex !== depositIndex) {
      throw new Error('Credential index conflicts with existing record');
    }

    if (!existing) {
      dispatch(addUserSecret({
        depositIndex,
        noteSecrets: [{ noteIndex: 0, ...secret }],
      }));
    }

    unwrapResult(await dispatch(discoverUserSecretsThunk({ secretManager })));

    return true;
};
