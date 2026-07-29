import { TxData } from '@kohaku-eth/provider';
import { createSelector } from '@reduxjs/toolkit';

import { prepareErc20Shield, prepareNativeShield } from '../../account/tx/shield';
import { E_ADDRESS } from '../../config';
import { IEntrypointDepositEvent, IIndexedDepositEvent } from '../../data/interfaces/events.interface';
import { Address, Precommitment } from '../../interfaces/types.interface';
import { addressToHex } from '../../utils';
import { aspLeavesSelector } from './asp.selector';
import { depositsSelector, entrypointDepositSelector, userSecretsSelector } from './slices.selectors';

export const myDepositsSelector = createSelector(
  [userSecretsSelector, depositsSelector, aspLeavesSelector],
  (userSecretsMap, depositsMap, approvedLabels): Map<Precommitment, IIndexedDepositEvent> => {
    const result = new Map<Precommitment, IIndexedDepositEvent>();

    for (const [precommitment, record] of userSecretsMap) {
      const deposit = depositsMap.get(precommitment);

      if (!deposit) continue;

      result.set(precommitment, {
        ...deposit,
        approved: approvedLabels.has(deposit.label),
        index: record.depositIndex,
      });
    }

    return result;
  },
);

export const myDepositsCountSelector = createSelector(
  [myDepositsSelector],
  (myDeposits): number => myDeposits.size,
);

export const myEntrypointDepositsSelector = createSelector(
  [myDepositsSelector, entrypointDepositSelector],
  (myDeposits, entrypointDepositsMap): Map<Precommitment, IEntrypointDepositEvent> => {
    const result = new Map<Precommitment, IEntrypointDepositEvent>();

    for (const [precommitment, { commitment }] of myDeposits) {
      const entrypointDeposit = entrypointDepositsMap.get(commitment);

      if (entrypointDeposit) {
        result.set(precommitment, entrypointDeposit);
      }
    }

    return result;
  },
);

export const buildDepositPayload = (precommitment: bigint, asset: Address, amount: bigint, entrypointAddress: Address): TxData => {
  const assetHex = addressToHex(asset);
  const entrypointHex = addressToHex(entrypointAddress);
  const isNative = assetHex.toLowerCase() === E_ADDRESS;

  if (isNative) {
    return prepareNativeShield({ precommitment, amount, entrypointAddress: entrypointHex });
  } else {
    return prepareErc20Shield({ precommitment, amount, tokenAddress: assetHex, entrypointAddress: entrypointHex });
  }
};
