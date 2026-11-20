import { describe, expect, it, vi } from 'vitest';

import type { Storage } from '@kohaku-eth/plugins';
import type { ISecretManager, Secret } from '../../src/account/keys';
import { TornadoCashConfigs } from '../../src/config';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { ISyncService } from '../../src/data/interfaces/sync.service.interface';
import type { Commitment, Nullifier, NullifierHash } from '../../src/interfaces/types.interface';
import type { IRelayerClient } from '../../src/relayer/interfaces/relayer-client.interface';
import { DepositStrategy } from '../../src/state/thunks/getDepositPayloadThunk';
import { storeStateManager } from '../../src/state/state-manager';
import type { ITornadoProver } from '../../src/utils/tornado-prover';

const POOL = 0x1234n;
const DENOMINATION = 10n ** 18n;

// A sync here only registers the one pool deposits go to.
vi.mock('../../src/state/thunks/syncThunk', async () => {
  const { createAsyncThunk } = await import('@reduxjs/toolkit');
  const { registerPools } = await import('../../src/state/slices/poolsSlice');

  return {
    syncThunk: createAsyncThunk('test/sync', (_: unknown, { dispatch }) => {
      dispatch(registerPools([{
        address: POOL,
        asset: 0n,
        isERC20: false,
        protocolFeePercentage: 0,
        denomination: DENOMINATION,
        registeredBlock: 0n,
        state: 1,
        rootHistorySize: 100,
      }]));

      // A complete sync: no pool failed.
      return { failures: [], totalPools: 1 };
    }),
  };
});

function createStorage() {
  const saved = new Map<string, string>();

  return {
    storage: {
      _brand: 'Storage',
      get: async (key: string) => saved.get(key),
      set: async (key: string, value: string) => { saved.set(key, value); },
    } as unknown as Storage,
    saved: () => JSON.parse([...saved.values()][0]!),
  };
}

function setup(storage: Storage, nonces: number[] = [], signatureGapLimit?: number) {
  const secretManager = {
    getSignatureSecrets: async ({ nonce }: { nonce: number }): Promise<Secret> => {
      nonces.push(nonce);

      return {
        nullifier: 1n as Nullifier,
        salt: 2n,
        commitment: BigInt(nonce + 1) as Commitment,
        nullifierHash: 3n as NullifierHash,
      };
    },
  } as unknown as ISecretManager;

  return storeStateManager({
    dataService: { getChainId: async () => 1n } as unknown as IDataService,
    syncService: {} as ISyncService,
    secretManagerFactory: async () => secretManager,
    proverFactory: async () => ({}) as ITornadoProver,
    relayerClient: {} as IRelayerClient,
    paymasterConfig: {},
    storageToSyncTo: storage,
    protocolConfig: {
      ...TornadoCashConfigs[1],
      instances: [{ address: POOL, asset: 0n, symbol: 'ETH', decimals: 18, denomination: DENOMINATION }],
      signatureGapLimit,
    },
  });
}

const deposit = (notes: number) => ({ asset: 0n, amount: DENOMINATION * BigInt(notes), strategy: DepositStrategy.MinFee });

describe('signature nonce reservation (F-53)', () => {
  it('persists reserved nonces privately and continues after them on reload', async () => {
    const { storage, saved } = createStorage();
    const first = await setup(storage);

    await first.sync();
    await first.getDepositPayload(deposit(3));

    expect(saved().signatureNonces.nextNonce).toBe(3);
    expect(Object.values(first.dumpState())[0]).not.toHaveProperty('signatureNonces');

    const nonces: number[] = [];
    const second = await setup(storage, nonces);

    await second.sync();
    await second.getDepositPayload(deposit(1));

    expect(nonces).toEqual([3]);
  });

  it('gives concurrent preparations disjoint nonces', async () => {
    const { storage } = createStorage();
    const nonces: number[] = [];
    const manager = await setup(storage, nonces);

    await manager.sync();
    await Promise.all([manager.getDepositPayload(deposit(2)), manager.getDepositPayload(deposit(2))]);

    expect([...nonces].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('rejects an out-of-range gap limit when created', async () => {
    await expect(setup(createStorage().storage, [], 5)).rejects.toThrow(/signatureGapLimit/);
  });
});
