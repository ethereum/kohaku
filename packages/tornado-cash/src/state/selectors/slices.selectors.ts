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
import { SignatureUserSecretRecord } from "../slices/signatureSecretsSlice";
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

/**
 * Pools used for deposits, withdrawals, balances, notes, and event sync.
 * Extended ETH pools stay in {@link poolsSelector} so a later opt-in can resume
 * from each pool's saved cursor, but they are hidden until
 * `useExtendedEthPools` is set.
 */
export const activePoolsSelector = createSelector(
  [poolsSelector, instanceRegistryInfoSelector],
  (pools, { useExtendedEthPools }) => {
    if (useExtendedEthPools) return pools;

    return new Map([...pools].filter(([, pool]) => !pool.extended));
  },
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

export const signatureUserSecretsSelector = selectEntityMap(
  (s) => s.signatureSecrets.byPool,
  deserialize as () => [Address, SignatureUserSecretRecord[]]
);

/**
 * Merges HD, signature, and imported secrets into a single per-pool map,
 * tagging each record with its `kind` so consumers can branch (e.g. paymaster
 * ephemeral signer derivation). Discovery reads the HD and signature slices
 * directly: HD resume uses array length, and signature nonces are global.
 * Imported secrets are merged first so they are spent first if any exist.
 */
export const userSecretsSelector = createSelector(
  [derivedUserSecretsSelector, legacyUserSecretsSelector, signatureUserSecretsSelector],
  (derived, legacy, signature): Map<Address, UserSecretEntry[]> => {
    const result = new Map<Address, UserSecretEntry[]>();

    const append = <T extends UserSecretEntry>(poolAddress: Address, records: T[]) => {
      const existing = result.get(poolAddress) ?? [];

      result.set(poolAddress, [...existing, ...records]);
    };

    for (const [poolAddress, records] of legacy) {
      append(poolAddress, records.map((record) => ({ kind: 'legacy' as const, ...record })));
    }

    for (const [poolAddress, records] of derived) {
      append(poolAddress, records.map((record) => ({ kind: 'derived' as const, ...record })));
    }

    for (const [poolAddress, records] of signature) {
      append(poolAddress, records.map((record) => ({ kind: 'signature' as const, ...record })));
    }

    return result;
  },
);
