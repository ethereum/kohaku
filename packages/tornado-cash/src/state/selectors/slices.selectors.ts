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
import { ProtocolConfigState } from "../slices/protocolConfigSlice";
import { IRelayerInfo } from "../slices/relayersSlice";
import { LegacyUserSecretRecord, UserSecretEntry, UserSecretRecord } from "../slices/userSecretsSlice";

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
  (poolInfo) => deserialize(poolInfo, { ensSubdomainKey: true }) as ProtocolConfigState,
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

export const derivedUserSecretsSelector = selectEntityMap(
  (s) => s.userSecrets.byPool,
  deserialize as () => [Address, UserSecretRecord[]]
);

export const legacyUserSecretsSelector = selectEntityMap(
  (s) => s.legacySecrets.byPool,
  deserialize as () => [Address, LegacyUserSecretRecord[]]
);

/**
 * Merges derived (HD-keystore) and legacy (imported note) secrets into a
 * single per-pool map, tagging each record with its `kind` so consumers can
 * branch (e.g. paymaster ephemeral signer derivation). Discovery
 * (`discoverUserEventsThunk`) intentionally reads `derivedUserSecretsSelector`
 * directly instead of this merged view — it relies on array length to resume
 * sequential HD derivation, an invariant legacy imports must not disturb.
 * Merges imported secrets first so they are spent first if any exists.
 */
export const userSecretsSelector = createSelector(
  [derivedUserSecretsSelector, legacyUserSecretsSelector],
  (derived, legacy): Map<Address, UserSecretEntry[]> => {
    const result = new Map<Address, UserSecretEntry[]>();

    for (const [poolAddress, records] of legacy) {
      const existing = result.get(poolAddress) ?? [];

      result.set(poolAddress, [...existing, ...records.map((record) => ({ kind: 'legacy' as const, ...record }))]);
    }

    for (const [poolAddress, records] of derived) {
      const existing = result.get(poolAddress) ?? [];

      result.set(poolAddress, [...existing, ...records.map((record) => ({ kind: 'derived' as const, ...record }))]);
    }

    return result;
  },
);
