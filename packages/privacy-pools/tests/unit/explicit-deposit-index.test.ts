import { describe, expect, it, vi } from 'vitest';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { IAspService } from '../../src/data/asp.interface';
import type { Address } from '../../src/interfaces/types.interface';
import type { PublicRootState } from '../../src/state/store';
import { storeStateManager } from '../../src/state/state-manager';
import { storeFactory } from '../../src/state/store';
import { buildDepositPayload } from '../../src/state/selectors/deposits.selector';
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

  const deposits = indexes.map(index => ({
    pool,
    depositor,
    commitment: 2000n + BigInt(index),
    label: 3000n + BigInt(index),
    precommitment: depositSecret(index).precommitment,
    value: index === 17 ? 100n : 40n,
    blockNumber: 105n,
    transactionHash: 123n,
  }));

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
};

function setup({
  withZero = false,
  withWithdrawal = false,
  wrongRoot = false,
  snapshot,
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
    } as unknown as IDataService,
    secretManager: { getDepositSecrets, getSecrets },
    aspService: {} as IAspService,
    initialState: async () => initial,
    devOptions: TEST_STORE_DEV_OPTIONS,
  } as never);

  return { manager, getDepositSecrets, getSecrets };
}

const derivedIndexes = ({ getDepositSecrets }: ReturnType<typeof setup>) =>
  getDepositSecrets.mock.calls.map(([{ depositIndex }]) => depositIndex);

const noteIndexes = async ({ manager }: ReturnType<typeof setup>) =>
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
    expect(derivedIndexes(context)).toEqual([17, 0, 18, 19, 20]);
  });

  it('derives each index once where sequences overlap', async () => {
    const context = setup({ snapshot: publicSnapshot(false, false, [0, 1, 2, 3]) });

    expect(await context.manager.registerDepositIndex(2)).toBe(true);

    expect(await noteIndexes(context)).toEqual([0, 1, 2, 3]);
    expect(derivedIndexes(context)).toEqual([2, 0, 1, 3, 4]);
  });

  it('stops discovery at the largest safe index', async () => {
    const largest = Number.MAX_SAFE_INTEGER;
    const context = setup({ snapshot: publicSnapshot(false, false, [largest - 1, largest]) });

    expect(await context.manager.registerDepositIndex(largest - 1)).toBe(true);

    expect(await noteIndexes(context)).toEqual([largest - 1, largest]);
    expect(derivedIndexes(context).every(Number.isSafeInteger)).toBe(true);
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

  it('allocates a shield after an in-flight registration without overlapping the signer', async () => {
    const context = setup();
    const { manager, getDepositSecrets } = context;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let active = 0;
    let maximumActive = 0;

    getDepositSecrets.mockImplementation(async ({ depositIndex }) => {
      maximumActive = Math.max(maximumActive, ++active);

      if (depositIndex === 17) {
        entered();
        await gate;
      }

      active--;

      return depositSecret(depositIndex);
    });

    const registration = manager.registerDepositIndex(17);

    await started;

    const shield = manager.getDepositPayload({ asset, amount: 1n });

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getDepositSecrets).toHaveBeenCalledTimes(1);

    release();

    const [registered, payload] = await Promise.all([registration, shield]);

    expect(registered).toBe(true);
    expect(maximumActive).toBe(1);
    expect(derivedIndexes(context)).toEqual([17, 0, 18, 18]);
    expect(payload).toEqual(buildDepositPayload(1018n, asset, 1n, entrypoint.address));
  });

  it('continues queued operations after a rejected signer operation', async () => {
    const { manager, getDepositSecrets } = setup();

    getDepositSecrets.mockRejectedValueOnce(new Error('Signer cancelled'));

    const [cancelled, registered, shield] = await Promise.allSettled([
      manager.getDepositPayload({ asset, amount: 1n }),
      manager.registerDepositIndex(17),
      manager.getDepositPayload({ asset, amount: 1n }),
    ]);

    expect(cancelled.status).toBe('rejected');
    expect(registered).toEqual({ status: 'fulfilled', value: true });
    expect(shield).toEqual({
      status: 'fulfilled',
      value: buildDepositPayload(1018n, asset, 1n, entrypoint.address),
    });
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
