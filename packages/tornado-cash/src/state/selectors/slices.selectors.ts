import { selectEntityMap } from "../utils/selectors.utils";
import { deserialize } from "../utils/serialize.utils";
import { RootState } from "../store";

import {
  Address,
  Commitment,
  NullifierHash,
} from "../../interfaces/types.interface";
import {
  IAsset,
  IPool,
  IDepositEvent,
  IWithdrawalEvent,
} from "../../data/interfaces/events.interface";
import { createSelector } from "@reduxjs/toolkit";
import { InstanceRegistryInfoState } from "../slices/instanceRegistryInfoSlice";
import { IRelayerInfo } from "../slices/relayersSlice";
import { UserSecretRecord } from "../slices/userSecretsSlice";

export const depositsSelector = createSelector(
  [(s: RootState) => s.deposits.depositsTuples],
  (tuples): Map<Address, Map<Commitment, IDepositEvent>> => {
    const deserialized = deserialize(tuples);

    return new Map(
      deserialized.map(
        ([poolAddress, innerTuples]) =>
          [poolAddress, new Map(innerTuples)] as const,
      ),
    );
  },
);

export const instanceRegistryInfoSelector = createSelector(
  [(state: RootState) => state.instanceRegistryInfo],
  (poolInfo) => deserialize(poolInfo, { ensSubdomainKey: true }) as InstanceRegistryInfoState,
);

/**
 * Maps asset address to IPoolInfo
 *
 */
export const poolsSelector = selectEntityMap(
  (s) => s.pools.poolsTuples,
  deserialize as () => [Address, IPool],
);

export const withdrawalsSelector = selectEntityMap(
  (s) => s.withdrawals.withdrawalsTuples,
  deserialize as () => [NullifierHash, IWithdrawalEvent],
);

export const assetSelector = selectEntityMap(
  (s) => s.assets.assetsTuples,
  (assetsTuple) =>
    deserialize(assetsTuple, [undefined, { name: true, symbol: true }]) as [
      Address,
      IAsset,
    ],
);

export const relayersSelector = createSelector(
  [(state: RootState) => state.relayers.relayersTuples],
  (tuples): IRelayerInfo[] =>
    tuples.map(([, relayer]) =>
      deserialize(relayer, { ensName: true, hostname: true }) as IRelayerInfo,
    ),
);

export const relayerFeeConfigSelector = (state: RootState) => state.relayers.feeConfig;

export const userSecretsSelector = selectEntityMap(
  (s) => s.userSecrets.byPool,
  deserialize as () => [Address, UserSecretRecord[]]
);
