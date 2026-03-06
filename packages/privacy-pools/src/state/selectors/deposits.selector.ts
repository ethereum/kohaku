import { TxData } from '@kohaku-eth/provider';
import { createSelector } from '@reduxjs/toolkit';

import { Secret } from '../../account/keys';
import { prepareErc20Shield, prepareNativeShield } from '../../account/tx/shield';
import { E_ADDRESS } from '../../config';
import { IEntrypointDepositEvent, IIndexedDepositEvent } from '../../data/interfaces/events.interface';
import { Address, Precommitment } from '../../interfaces/types.interface';
import { addressToHex } from '../../utils';
import { BaseSelectorParams } from '../interfaces/selectors.interface';
import { RootState } from '../store';
import { aspLeavesSelector } from './asp.selector';
import { depositsSelector, entrypointDepositSelector, entrypointInfoSelector } from './slices.selectors';

/**
 * Returns a Map with every deposit we own. We also check approved status.
 */
export const createMyDepositsSelector = ({
  secretManager,
}: Pick<BaseSelectorParams, 'secretManager'>) => {
  return createSelector(
    [
      depositsSelector,
      aspLeavesSelector,
      entrypointInfoSelector,
    ],
    (depositsMap, approvedLabels, { chainId, entrypointAddress }): Map<Precommitment, IIndexedDepositEvent> => {
      const myDeposits: IIndexedDepositEvent[] = [];

      for (let depositIndex = 0; ; depositIndex++) {
        const { precommitment } = secretManager.getDepositSecrets({
          entrypointAddress,
          chainId,
          depositIndex,
        });

        const deposit = depositsMap.get(precommitment);

        if (!deposit) {
          break;
        }

        myDeposits.push({
          ...deposit,
          approved: approvedLabels.has(deposit.label),
          index: depositIndex,
        });
      }

      return new Map(myDeposits.map((deposit) => [deposit.precommitment, deposit] as const));
    }
  );
};

export const createMyDepositsCountSelector = (
  myDepositsSelector: ReturnType<typeof createMyDepositsSelector>,
) => {
  return createSelector(
    [myDepositsSelector],
    (myDeposits): number => {
      return myDeposits.size;
    }
  );
};

export const createMyEntrypointDepositsSelector = (
  myDepositsSelector: ReturnType<typeof createMyDepositsSelector>,
) => {
  return createSelector(
    [
      myDepositsSelector,
      entrypointDepositSelector,
    ],
    (myDeposits, entrypointDepositsMap): Map<Precommitment, IEntrypointDepositEvent> => {
      const entrypointDepositByPrecommitment = Array.from(myDeposits)
        .map(([precommitment, { commitment }]) => [precommitment, entrypointDepositsMap.get(commitment)] as const)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .filter(([_, e]) => e !== undefined);

      return new Map(entrypointDepositByPrecommitment as [Precommitment, IEntrypointDepositEvent][])
    }
  );
};

/**
 * 
 * Given our state, computes the next secret in the sequence for a new deposit
 *
 */
export const createGetNextDepositSecretsSelector = ({
  depositsCountSelector,
  secretManager,
}: {
  depositsCountSelector: ReturnType<typeof createMyDepositsCountSelector>;
  secretManager: BaseSelectorParams['secretManager'];
}) => {
  return createSelector(
    [
      depositsCountSelector,
      entrypointInfoSelector,
    ],
    (depositCount, { chainId, entrypointAddress }): Secret => {
      return secretManager.getDepositSecrets({
        entrypointAddress,
        chainId,
        depositIndex: depositCount,
      });
    }
  );
};

export const createGetNextDepositPayloadSelector = ({
  getNextDepositSecretsSelector,
}: {
  getNextDepositSecretsSelector: ReturnType<typeof createGetNextDepositSecretsSelector>;
}) => {
  return createSelector(
    [
      getNextDepositSecretsSelector,
      (_state: RootState, asset: Address) => asset,
      (_state: RootState, _asset: Address, amount: bigint) => amount,
      entrypointInfoSelector,
    ],
    ({ precommitment }, asset, amount, { entrypointAddress }): TxData => {
      const assetHex = addressToHex(asset);
      const entrypointHex = addressToHex(entrypointAddress);
      const isNative = assetHex.toLowerCase() === E_ADDRESS;

      if (isNative) {
        return prepareNativeShield({
          precommitment,
          amount,
          entrypointAddress: entrypointHex,
        });
      } else {
        return prepareErc20Shield({
          precommitment,
          amount,
          tokenAddress: assetHex,
          entrypointAddress: entrypointHex,
        });
      }
    }
  );
};
