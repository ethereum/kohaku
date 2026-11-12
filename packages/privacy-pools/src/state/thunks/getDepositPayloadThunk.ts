import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import type { ISecretManager } from '../../account/keys';
import type { IDepositOperationParams } from '../../plugin/interfaces/protocol-params.interface';
import { buildDepositPayload } from '../selectors/deposits.selector';
import {
  depositsSelector,
  entrypointInfoSelector,
  userSecretsSelector,
} from '../selectors/slices.selectors';
import type { RootState } from '../store';

type GetDepositPayloadThunk = ThunkAction<
  Promise<ReturnType<typeof buildDepositPayload>>,
  RootState,
  unknown,
  UnknownAction
>;

export const getDepositPayloadThunk = (
  params: IDepositOperationParams & { secretManager: ISecretManager },
): GetDepositPayloadThunk => async (_dispatch, getState) => {
  const { asset, amount, depositIndex: requestedIndex, secretManager } = params;

    const state = getState();
    const { chainId, entrypointAddress } = entrypointInfoSelector(state);
    const knownIndices = [...userSecretsSelector(state).values()]
      .map(record => record.depositIndex);

    const automaticIndex = knownIndices.reduce(
      (next, index) => Math.max(next, index + 1),
      0,
    );
    const depositIndex = requestedIndex ?? automaticIndex;

    if (!Number.isSafeInteger(depositIndex) || depositIndex < 0) {
      throw new RangeError('Invalid deposit index');
    }

    if (knownIndices.includes(depositIndex)) {
      throw new Error('Deposit index already registered');
    }

    const { precommitment } = await secretManager.getDepositSecrets({
      entrypointAddress,
      chainId,
      depositIndex,
    });

    if (depositsSelector(getState()).has(precommitment)) {
      throw new Error('Deposit credential already exists on-chain');
    }

    return buildDepositPayload(
      precommitment,
      asset,
      amount,
      entrypointAddress,
    );
};
