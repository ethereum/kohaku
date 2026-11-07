import { describe, expect, it, vi } from 'vitest';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { IAspService } from '../../src/data/asp.interface';
import type { Address } from '../../src/interfaces/types.interface';
import type { PublicRootState } from '../../src/state/store';
import { storeStateManager } from '../../src/state/state-manager';
import { storeFactory } from '../../src/state/store';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerEntrypointDeposits } from '../../src/state/slices/entrypointDepositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { registerWithdrawals } from '../../src/state/slices/withdrawalsSlice';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const chainId = 1n;
const entrypoint = { address: 900n as Address, deploymentBlock: 100n };
const pool = 1000n as Address;
const asset = 2000n as Address;
const depositor = 3000n as Address;
const storageKey = 'privacy-pool-state-1-900';

const depositSecret = (index: number, wrongRoot = false) => {
  const n = BigInt(index);
  return {
    nullifier: 10n + n,
    salt: 20n + n,
    precommitment: (wrongRoot ? 9000n : 1000n) + n,
    nullifierHash: 500n + n,
  };
};

const depositEvent = (index: number) => ({
  pool,
  depositor,
  commitment: 2000n + BigInt(index),
  label: 3000n + BigInt(index),
  precommitment: depositSecret(index).precommitment,
  value: index === 17 ? 100n : 40n,
  blockNumber: 105n,
  transactionHash: 123n,
});

function publicSnapshot(
  withZero: boolean,
  withWithdrawal: boolean,
  indexes = withZero ? [0, 17] : [17],
  spentIndex = 17,
) {
  const store = storeFactory({
    logLevel: 'off',
    devOptions: TEST_STORE_DEV_OPTIONS,
    entrypointInfo: {
      chainId,
      entrypointAddress: entrypoint.address,
      deploymentBlock: entrypoint.deploymentBlock,
    },
  });

  store.dispatch(registerPools([{
    address: pool,
    asset,
    scope: 1n,
    registeredBlock: 100n,
    woundDownAtBlock: null,
  }]));

  const deposits = indexes.map(depositEvent);

  store.dispatch(registerDeposits(deposits));

  store.dispatch(registerEntrypointDeposits(
    deposits.map(d => ({
      depositor,
      poolAddress: pool,
      commitment: d.commitment,
      blockNumber: d.blockNumber,
      transactionHash: d.transactionHash,
    })),
  ));

  if (withWithdrawal) {
    store.dispatch(registerWithdrawals([{
      pool,
      spentNullifier: depositSecret(spentIndex).nullifierHash,
      commitment: 8888n,
      value: 30n,
      blockNumber: 106n,
      transactionHash: 124n,
    }]));
  }

  // The SDK's public snapshot explicitly excludes these slices.
  const {
    userSecrets,
    historyMetadata,
    aspVerification,
    ...publicState
  } = store.getState();

  void userSecrets;
  void historyMetadata;
  void aspVerification;

  return { [storageKey]: publicState as PublicRootState };
}

type SetupOptions = {
  withZero?: boolean;
  withWithdrawal?: boolean;
  wrongRoot?: boolean;
  snapshot?: Record<string, PublicRootState>;
  dataService?: Partial<Record<keyof IDataService, unknown>>;
};

function setup({
  withZero = false,
  withWithdrawal = false,
  wrongRoot = false,
  snapshot,
  dataService,
}: SetupOptions = {}) {
  const getDepositSecrets = vi.fn(async ({
    depositIndex,
  }: { depositIndex: number }) =>
    depositSecret(depositIndex, wrongRoot)
  );

  const getSecrets = vi.fn(async ({
    depositIndex,
    withdrawIndex,
  }: { depositIndex: number; withdrawIndex: number }) => ({
    nullifier: 700n + BigInt(withdrawIndex),
    salt: 800n + BigInt(withdrawIndex),
    precommitment: 900n + BigInt(depositIndex),
    nullifierHash: 9000n + BigInt(withdrawIndex),
  }));

  const initial = snapshot ?? publicSnapshot(withZero, withWithdrawal);

  const manager = storeStateManager({
    entrypoint,
    dataService: {
      getChainId: vi.fn(async () => chainId),
      ...dataService,
    } as unknown as IDataService,
    secretManager: { getDepositSecrets, getSecrets },
    aspService: {} as IAspService,
    initialState: async () => initial,
    devOptions: TEST_STORE_DEV_OPTIONS,
  } as never);

  return { manager, getDepositSecrets, getSecrets };
}

type DepositSecretsMock = ReturnType<typeof setup>['getDepositSecrets'];

const derivedIndexes = (getDepositSecrets: DepositSecretsMock) =>
  getDepositSecrets.mock.calls.map(([{ depositIndex }]) => depositIndex);

const noteIndexes = async ({ manager }: Pick<ReturnType<typeof setup>, 'manager'>) =>
  (await manager.getNotes({})).map(note => note.deposit).sort((a, b) => a - b);

describe('explicit deposit index registration', () => {
  it('rejects invalid indexes', async () => {
    const { manager } = setup();

    for (const index of [-1, 1.5, NaN, Infinity, 2 ** 53]) {
      await expect(manager.registerDepositIndex(index))
        .rejects.toThrow(RangeError);
    }
  });

  it('does not register an unmatched credential', async () => {
    const { manager } = setup({ wrongRoot: true });

    expect(await manager.registerDepositIndex(17)).toBe(false);
    expect(await manager.getNotes({})).toEqual([]);
  });

  it('recovers sparse index 17 without private snapshot injection', async () => {
    const { manager } = setup();

    expect(await manager.getNotes({})).toEqual([]);
    expect(await manager.registerDepositIndex(17)).toBe(true);

    expect(await manager.getNotes({})).toMatchObject([{
      deposit: 17,
      withdraw: 0,
      precommitment: 1017n,
      balance: 100n,
      assetAddress: asset,
    }]);

    const dump = manager.dumpState();

    expect(dump[storageKey]).toBeDefined();
    expect(dump[storageKey]).not.toHaveProperty('userSecrets');
    expect(dump[storageKey]).not.toHaveProperty('historyMetadata');
    expect(dump[storageKey]).not.toHaveProperty('aspVerification');
  });

  it('preserves sequential discovery when index 17 is registered', async () => {
    const { manager } = setup({ withZero: true });

    expect(await manager.registerDepositIndex(17)).toBe(true);

    const indexes = (await manager.getNotes({}))
      .map(note => note.deposit)
      .sort((a, b) => a - b);

    expect(indexes).toEqual([0, 17]);
  });

  it('reconstructs withdrawal lineage for index 17', async () => {
    const { manager, getSecrets } = setup({
      withWithdrawal: true,
    });

    expect(await manager.registerDepositIndex(17)).toBe(true);

    expect(await manager.getNotes({})).toMatchObject([{
      deposit: 17,
      withdraw: 1,
      balance: 70n,
    }]);

    expect(getSecrets).toHaveBeenCalledWith(
      expect.objectContaining({
        depositIndex: 17,
        withdrawIndex: 1,
      }),
    );
  });

  it('is idempotent across repeated registration', async () => {
    const { manager } = setup({ withWithdrawal: true });

    expect(await manager.registerDepositIndex(17)).toBe(true);
    const first = await manager.getNotes({ includeSpent: true });

    expect(await manager.registerDepositIndex(17)).toBe(true);
    const second = await manager.getNotes({ includeSpent: true });

    expect(second).toEqual(first);
    expect(second).toHaveLength(1);
    expect(second[0]?.withdraw).toBe(1);
  });

  it('cold-recovers from public state alone', async () => {
    const { manager } = setup();

    expect(await manager.registerDepositIndex(17)).toBe(true);
    const publicState = manager.dumpState();

    const { manager: fresh } = setup({
      snapshot: publicState,
    });

    expect(await fresh.getNotes({})).toEqual([]);
    expect(await fresh.registerDepositIndex(17)).toBe(true);

    expect(await fresh.getNotes({}))
      .toEqual(await manager.getNotes({}));
  });

  it('never reuses index 17 for a new shield', async () => {
    const { manager, getDepositSecrets } = setup();

    expect(await manager.registerDepositIndex(17)).toBe(true);

    await manager.getDepositPayload({
      asset,
      amount: 1n,
    });

    const finalCall = getDepositSecrets.mock.calls.at(-1)?.[0];

    expect(finalCall).toMatchObject({
      depositIndex: 18,
    });
  });

  it('discovers contiguous deposits after a registered sparse index', async () => {
    const context = setup({ snapshot: publicSnapshot(false, false, [17, 18, 19]) });

    expect(await context.manager.registerDepositIndex(17)).toBe(true);

    expect(await noteIndexes(context)).toEqual([17, 18, 19]);
    // One probe of the absent zero sequence, and none of the gap from 1 to 16.
    expect(derivedIndexes(context.getDepositSecrets)).toEqual([17, 0, 18, 19, 20]);

    await context.manager.getDepositPayload({ asset, amount: 1n });
    expect(context.getDepositSecrets.mock.calls.at(-1)?.[0].depositIndex).toBe(20);
  });

  it('discovers an allocated shield through sync after it confirms', async () => {
    const noPoolEvents = { PoolDeposited: [], Withdrawn: [], Ragequit: [], LeafInserted: [] };
    const noEntrypointEvents = { EntrypointDeposited: [], RootUpdated: [], PoolRegistered: [], PoolWindDown: [] };
    const getPoolEvents = vi.fn(async () => noPoolEvents);
    const getEntrypointEvents = vi.fn(async () => noEntrypointEvents);
    const context = setup({
      dataService: {
        getBlockNumber: vi.fn(async () => 200n),
        getEntrypointEvents,
        getPoolEvents,
        getAsset: vi.fn(async () => ({ address: asset, name: 'Asset', symbol: 'A', decimals: 18n })),
      },
    });

    expect(await context.manager.registerDepositIndex(17)).toBe(true);
    await context.manager.getDepositPayload({ asset, amount: 1n });
    expect(context.getDepositSecrets.mock.calls.at(-1)?.[0].depositIndex).toBe(18);

    const confirmed = depositEvent(18);

    getPoolEvents.mockResolvedValueOnce({ ...noPoolEvents, PoolDeposited: [confirmed] } as never);
    getEntrypointEvents.mockResolvedValueOnce({
      ...noEntrypointEvents,
      EntrypointDeposited: [{
        depositor,
        poolAddress: pool,
        commitment: confirmed.commitment,
        blockNumber: confirmed.blockNumber,
        transactionHash: confirmed.transactionHash,
      }],
    } as never);
    await context.manager.sync();

    expect(await noteIndexes(context)).toEqual([17, 18]);
  });

  it('recovers contiguous successors after restarting from public state', async () => {
    const context = setup({ snapshot: publicSnapshot(false, false, [17, 18, 19]) });

    await context.manager.registerDepositIndex(17);

    const publicState = context.manager.dumpState();

    expect(publicState[storageKey]).not.toHaveProperty('userSecrets');

    const restarted = setup({ snapshot: publicState });

    expect(await noteIndexes(restarted)).toEqual([]);
    expect(await restarted.manager.registerDepositIndex(17)).toBe(true);
    expect(await noteIndexes(restarted)).toEqual([17, 18, 19]);
  });

  it('recovers withdrawal lineage of a discovered successor', async () => {
    const { manager, getSecrets } = setup({ snapshot: publicSnapshot(false, true, [17, 18], 18) });

    expect(await manager.registerDepositIndex(17)).toBe(true);

    expect(await manager.getNotes({})).toEqual(expect.arrayContaining([
      expect.objectContaining({ deposit: 17, withdraw: 0 }),
      expect.objectContaining({ deposit: 18, withdraw: 1 }),
    ]));
    expect(getSecrets).toHaveBeenCalledWith(expect.objectContaining({ depositIndex: 18, withdrawIndex: 1 }));
  });

  it('derives each index once where sequences overlap', async () => {
    const context = setup({ snapshot: publicSnapshot(false, false, [0, 1, 2, 3]) });

    expect(await context.manager.registerDepositIndex(2)).toBe(true);

    expect(await noteIndexes(context)).toEqual([0, 1, 2, 3]);
    expect(derivedIndexes(context.getDepositSecrets)).toEqual([2, 0, 1, 3, 4]);
  });

  it('probes once per sequence across large gaps', async () => {
    const context = setup({ snapshot: publicSnapshot(false, false, [5, 1_000_000, 1_000_001]) });

    expect(await context.manager.registerDepositIndex(5)).toBe(true);
    context.getDepositSecrets.mockClear();

    expect(await context.manager.registerDepositIndex(1_000_000)).toBe(true);

    expect(await noteIndexes(context)).toEqual([5, 1_000_000, 1_000_001]);
    expect(derivedIndexes(context.getDepositSecrets)).toEqual([1_000_000, 0, 6, 1_000_001, 1_000_002]);
  });

  it('stops discovery at the largest safe index', async () => {
    const largest = Number.MAX_SAFE_INTEGER;
    const context = setup({ snapshot: publicSnapshot(false, false, [largest - 1, largest]) });

    expect(await context.manager.registerDepositIndex(largest - 1)).toBe(true);
    expect(await noteIndexes(context)).toEqual([largest - 1, largest]);

    expect(await context.manager.registerDepositIndex(largest)).toBe(true);
    expect(derivedIndexes(context.getDepositSecrets).every(Number.isSafeInteger)).toBe(true);

    await expect(context.manager.getDepositPayload({ asset, amount: 1n }))
      .rejects.toThrow('Invalid deposit index');
  });

  it('refuses a shield on a registered or publicly observed credential', async () => {
    const { manager } = setup();
    const explicit = { asset, amount: 1n, depositIndex: 17 };

    await expect(manager.getDepositPayload(explicit))
      .rejects.toThrow('Deposit credential already exists on-chain');

    await manager.registerDepositIndex(17);

    await expect(manager.getDepositPayload(explicit))
      .rejects.toThrow('Deposit index already registered');
  });

  it('continues queued registration after a rejected registration', async () => {
    const context = setup();

    context.getDepositSecrets.mockRejectedValueOnce(new Error('Signer cancelled'));

    const results = await Promise.allSettled([
      context.manager.registerDepositIndex(17),
      context.manager.registerDepositIndex(17),
    ]);

    expect(results.map(({ status }) => status)).toEqual(['rejected', 'fulfilled']);
    expect(await noteIndexes(context)).toEqual([17]);
  });

  it('serializes concurrent registrations for a non-reentrant secret manager', async () => {
    const { manager, getDepositSecrets } = setup();

    let active = 0;
    let maximumActive = 0;

    getDepositSecrets.mockImplementation(async ({
      depositIndex,
    }: { depositIndex: number }) => {
      active++;
      maximumActive = Math.max(maximumActive, active);

      try {
        await new Promise<void>(resolve => setTimeout(resolve, 5));
        return depositSecret(depositIndex);
      } finally {
        active--;
      }
    });

    const results = await Promise.all([
      manager.registerDepositIndex(17),
      manager.registerDepositIndex(17),
      manager.registerDepositIndex(17),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(maximumActive).toBe(1);

    const notes = await manager.getNotes({});
    expect(notes).toHaveLength(1);
    expect(notes[0]?.deposit).toBe(17);
  });

});
