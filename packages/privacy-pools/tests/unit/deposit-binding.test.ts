import { poseidon } from 'maci-crypto/build/ts/hashing.js';
import { describe, expect, it } from 'vitest';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { myDepositsWithAssetSelector } from '../../src/state/selectors/balance.selector';
import { myEntrypointDepositsSelector } from '../../src/state/selectors/deposits.selector';
import { myPoolsSelector } from '../../src/state/selectors/pools.selector';
import { depositsSelector, poolsLeavesSelector } from '../../src/state/selectors/slices.selectors';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerEntrypointDeposits } from '../../src/state/slices/entrypointDepositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { addUserSecret } from '../../src/state/slices/userSecretsSlice';
import { storeFactory } from '../../src/state/store';
import { syncEventsThunk } from '../../src/state/thunks/syncEventsThunk';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const pool = 1000n as Address;
const otherPool = 1001n as Address;
const depositor = 3000n as Address;
const myPrecommitment = 77n;
const myLabel = 10n;
const myCommitment = poseidon([100n, myLabel, myPrecommitment]);

const myDeposit = {
  depositor, commitment: myCommitment, label: myLabel, value: 100n, precommitment: myPrecommitment,
  blockNumber: 105n, transactionHash: 0n,
};
const myLeaf = { index: 1n, commitment: myCommitment, root: 1n, blockNumber: 105n, transactionHash: 0n };

const setupStore = () => {
  const store = storeFactory({
    logLevel: 'off', devOptions: TEST_STORE_DEV_OPTIONS,
    entrypointInfo: { chainId: 1n, entrypointAddress: 900n as Address, deploymentBlock: 100n },
  });

  store.dispatch(registerPools([pool, otherPool].map((address, scope) => ({
    address, asset: address + 1000n, scope: BigInt(scope), registeredBlock: 100n, woundDownAtBlock: null,
  }))));

  return store;
};

// One pool scan: every pool returns `PoolDeposited` and `LeafInserted` as given.
const syncPools = (store: ReturnType<typeof setupStore>, PoolDeposited: object[], LeafInserted: object[]) => {
  const getPoolEvents = async ({ address }: { address: Address }) => ({
    PoolDeposited: address === pool ? PoolDeposited : [],
    LeafInserted: address === pool ? LeafInserted : [],
    Withdrawn: [], Ragequit: [], fromBlock: 100n, toBlock: 110n,
  });

  return store.dispatch(syncEventsThunk({
    dataService: { getPoolEvents } as unknown as IDataService, fromBlock: 100n, toBlock: 110n,
  })).unwrap();
};

describe('pool deposits bound to verified leaves', () => {
  it('registers a deposit that hashes to one of its pool leaves', async () => {
    const store = setupStore();

    await syncPools(store, [myDeposit], [myLeaf]);

    expect(depositsSelector(store.getState()).get(myPrecommitment)).toMatchObject({ value: 100n, pool });
  });

  it('fails the sync on a deposit whose value, label or precommitment do not hash to its commitment', async () => {
    const store = setupStore();
    // A real precommitment and leaf, with a value the source made up.
    const forged = { ...myDeposit, value: 1_000_000n };

    await expect(syncPools(store, [forged], [myLeaf])).rejects.toThrow('does not match its value, label and precommitment');
    expect(depositsSelector(store.getState()).size).toBe(0);
    expect(poolsLeavesSelector(store.getState()).size).toBe(0);
  });

  it('fails the sync on a deposit with no inserted leaf', async () => {
    const store = setupStore();
    // Consistent with itself, but not part of the pool tree the root check covers.
    const forgedLabel = 11n;
    const forged = { ...myDeposit, label: forgedLabel, commitment: poseidon([100n, forgedLabel, myPrecommitment]) };

    await expect(syncPools(store, [forged], [myLeaf])).rejects.toThrow('has no inserted leaf');
    expect(depositsSelector(store.getState()).size).toBe(0);
  });

  it('ignores an entrypoint deposit that names another pool', () => {
    const store = setupStore();

    store.dispatch(registerDeposits([{ ...myDeposit, pool }]));
    store.dispatch(addUserSecret({
      depositIndex: 0,
      noteSecrets: [{ noteIndex: 0, nullifier: 0n, salt: 0n, precommitment: myPrecommitment, nullifierHash: 5n }],
    }));
    store.dispatch(registerEntrypointDeposits([
      { depositor, poolAddress: otherPool, commitment: myCommitment, blockNumber: 105n, transactionHash: 0n },
    ]));

    expect(myDepositsWithAssetSelector(store.getState()).size).toBe(0);
    expect(myEntrypointDepositsSelector(store.getState()).size).toBe(0);
    expect(myPoolsSelector(store.getState())).toEqual([]);

    store.dispatch(registerEntrypointDeposits([
      { depositor, poolAddress: pool, commitment: myCommitment, blockNumber: 105n, transactionHash: 0n },
    ]));

    expect(myDepositsWithAssetSelector(store.getState()).get(myPrecommitment)?.assetAddress).toBe(pool + 1000n);
    expect(myPoolsSelector(store.getState()).map(({ address }) => address)).toEqual([pool]);
  });
});
