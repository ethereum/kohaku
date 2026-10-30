import { describe, expect, it, vi } from 'vitest';
import type { IAspService } from '../../src/data/asp.interface';
import type { IRootUpdatedEvent } from '../../src/data/interfaces/events.interface';
import type { Address } from '../../src/interfaces/types.interface';
import type { INote } from '../../src/plugin/interfaces/protocol-params.interface';
import { aspSelector, verifiedAspRootSelector } from '../../src/state/selectors/slices.selectors';
import { registerAspTree } from '../../src/state/slices/aspSlice';
import { setVerifiedAspRoot } from '../../src/state/slices/aspVerificationSlice';
import { registerPoolLeaves } from '../../src/state/slices/poolLeavesSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { registerLastUpdateRootEvent } from '../../src/state/slices/updateRootEventsSlice';
import { addUserSecret } from '../../src/state/slices/userSecretsSlice';
import { storeFactory } from '../../src/state/store';
import { syncAspThunk } from '../../src/state/thunks/syncAspThunk';
import { withdrawThunk } from '../../src/state/thunks/withdrawThunk';
import { commitment } from '../../src/utils';
import { computeMerkleTreeRoot, SNARK_SCALAR_FIELD } from '../../src/utils/proof.util';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const entrypointAddress = 900n as Address;
const pool = 1000n as Address;
const asset = 2000n as Address;

// The real association set: the user's label 20n is approved.
const realLeaves = [10n, 20n, 30n, 40n, 50n];
const realRoot = await computeMerkleTreeRoot(realLeaves);

const rootUpdated = (root: bigint, blockNumber = 7n): IRootUpdatedEvent => ({
  root, ipfsCID: 'cid', timestamp: 1n, blockNumber, transactionHash: 0n,
});

const setupStore = () => {
  const store = storeFactory({
    logLevel: 'off',
    devOptions: TEST_STORE_DEV_OPTIONS,
    entrypointInfo: { chainId: 1n, entrypointAddress, deploymentBlock: 0n },
  });

  store.dispatch(registerLastUpdateRootEvent(rootUpdated(realRoot)));

  return store;
};

// A gateway that serves `levels` as the tree JSON, as IPFSAspService passes it on.
const serving = (levels: bigint[][]) => ({ getAspTree: vi.fn(async () => levels) }) satisfies IAspService;

describe('syncAspThunk', () => {
  it('accepts a tree whose leaves rebuild the RootUpdated root', async () => {
    const store = setupStore();

    await store.dispatch(syncAspThunk({ aspService: serving([realLeaves, [realRoot]]) })).unwrap();

    expect(aspSelector(store.getState())).toEqual({ leaves: realLeaves, aspTreeRoot: realRoot, blockNumber: 7n });
  });

  it('rejects leaves that drop an approved label even if the served root is right', async () => {
    const store = setupStore();
    const hidden = realLeaves.filter((leaf) => leaf !== 20n);

    await expect(
      store.dispatch(syncAspThunk({ aspService: serving([hidden, [realRoot]]) })).unwrap(),
    ).rejects.toThrow('ASP tree root mismatch');
    expect(aspSelector(store.getState()).leaves).toEqual([]);
  });

  it('rejects leaves that add a label even if the served root is right', async () => {
    const store = setupStore();

    await expect(
      store.dispatch(syncAspThunk({ aspService: serving([[...realLeaves, 60n], [realRoot]]) })).unwrap(),
    ).rejects.toThrow('ASP tree root mismatch');
  });

  it('rejects a label shifted by the field modulus, which hashes to the same root', async () => {
    const store = setupStore();
    const aliased = realLeaves.map((leaf) => (leaf === 20n ? leaf + SNARK_SCALAR_FIELD : leaf));

    await expect(
      store.dispatch(syncAspThunk({ aspService: serving([aliased, [realRoot]]) })).unwrap(),
    ).rejects.toThrow('not a SNARK field element');
  });

  it('refetches when stored leaves do not build the stored root', async () => {
    const store = setupStore();

    // As saved by an older version that trusted the gateway's root level.
    store.dispatch(registerAspTree({ leaves: [10n, 30n], aspTreeRoot: realRoot, blockNumber: 7n }));

    const aspService = serving([realLeaves, [realRoot]]);

    await store.dispatch(syncAspThunk({ aspService })).unwrap();

    expect(aspService.getAspTree).toHaveBeenCalledTimes(1);
    expect(aspSelector(store.getState()).leaves).toEqual(realLeaves);
  });

  it('does not refetch an up-to-date tree', async () => {
    const store = setupStore();

    store.dispatch(registerAspTree({ leaves: realLeaves, aspTreeRoot: realRoot, blockNumber: 7n }));

    const aspService = serving([[], []]);

    await store.dispatch(syncAspThunk({ aspService })).unwrap();

    expect(aspService.getAspTree).not.toHaveBeenCalled();
  });
});

describe('withdrawThunk ASP root', () => {
  const secrets = { nullifier: 1n, salt: 2n, precommitment: 3n, nullifierHash: 4n };
  const note: INote = {
    label: 20n,
    precommitment: secrets.precommitment,
    value: 100n,
    balance: 100n,
    assetAddress: asset,
    approved: true,
    depositor: 5n as Address,
    deposit: 0,
    withdraw: 0,
  };

  const setupWithdrawStore = () => {
    const store = setupStore();

    store.dispatch(registerPools([{ address: pool, asset, scope: 1n, registeredBlock: 0n, woundDownAtBlock: null }]));
    store.dispatch(registerPoolLeaves({
      poolAddress: pool,
      leaves: [{ index: 1n, commitment: commitment(note), root: 0n, blockNumber: 1n, transactionHash: 0n }],
    }));
    store.dispatch(addUserSecret({ depositIndex: 0, noteSecrets: [{ noteIndex: 0, ...secrets }] }));
    store.dispatch(registerAspTree({ leaves: realLeaves, aspTreeRoot: realRoot, blockNumber: 7n }));

    return store;
  };

  const withdraw = (store: ReturnType<typeof setupStore>) => {
    const prove = vi.fn(async () => ({ proof: {}, publicSignals: [], mappedSignals: {} }));
    const proverFactory = vi.fn(async () => ({ prove }));
    const action = store.dispatch(withdrawThunk({
      getNextNote: async () => ({ note, secrets: { ...secrets, nullifier: 9n, salt: 9n } }),
      proverFactory: proverFactory as never,
      asset,
      amount: 10n,
      recipient: 6n as Address,
      context: 1n,
      note,
    })).unwrap();

    return { action, prove };
  };

  it('refuses to prove before the ASP root was verified on-chain this session', async () => {
    const store = setupWithdrawStore();
    const { action, prove } = withdraw(store);

    await expect(action).rejects.toThrow('ASP root not verified on-chain');
    expect(prove).not.toHaveBeenCalled();
  });

  it('refuses to prove against a tree other than the verified one', async () => {
    const store = setupWithdrawStore();

    store.dispatch(setVerifiedAspRoot(await computeMerkleTreeRoot([10n, 20n])));

    const { action, prove } = withdraw(store);

    await expect(action).rejects.toThrow('ASP root not verified on-chain');
    expect(prove).not.toHaveBeenCalled();
  });

  it('proves against the verified root', async () => {
    const store = setupWithdrawStore();

    store.dispatch(setVerifiedAspRoot(realRoot));

    const { action, prove } = withdraw(store);

    await action;

    expect(verifiedAspRootSelector(store.getState())).toBe(realRoot);
    expect(prove).toHaveBeenCalledWith('withdraw', expect.objectContaining({ ASPRoot: realRoot, label: 20n }));
  });
});
