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

export const depositsSelector = selectEntityMap(
  (s) => s.deposits.depositsTuples,
  deserialize as () => [Commitment, IDepositEvent],
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
