import { describe, expect, it, vi } from 'vitest';

import type { ISecretManager } from '../../src/account/keys';
import { TornadoCashConfigs } from '../../src/config';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { ISyncService } from '../../src/data/interfaces/sync.service.interface';
import type { IRelayerClient } from '../../src/relayer/interfaces/relayer-client.interface';
import { storeStateManager } from '../../src/state/state-manager';
import type { ITornadoProver } from '../../src/utils/tornado-prover';

// Exercise the real sync and withdrawal routing without generating proofs.
vi.mock('../../src/state/thunks/paymasterWithdrawThunk', async () => {
  const { createAsyncThunk } = await import('@reduxjs/toolkit');

  return { paymasterWithdrawThunk: createAsyncThunk('test/paymaster', async () => []) };
});
vi.mock('../../src/state/thunks/withdrawThunk', async () => {
  const { createAsyncThunk } = await import('@reduxjs/toolkit');

  return { withdrawThunk: createAsyncThunk('test/relayer', async () => []) };
});

async function setup() {
  const getRelayerData = vi.fn().mockRejectedValue(new Error('execution reverted'));
  const getRelayerRegistryEvents = vi.fn().mockRejectedValue(new Error('relayer registry unavailable'));
  const manager = await storeStateManager({
    dataService: {
      getChainId: async () => 1n,
      getAllPoolsAddresses: async () => [],
      getRelayerData,
    } as unknown as IDataService,
    syncService: { getRelayerRegistryEvents } as unknown as ISyncService,
    secretManagerFactory: async () => ({}) as ISecretManager,
    proverFactory: async () => ({}) as ITornadoProver,
    relayerClient: {} as IRelayerClient,
    paymasterConfig: {},
    protocolConfig: TornadoCashConfigs[1],
  });

  return { manager, getRelayerData, getRelayerRegistryEvents };
}

describe('relayer discovery scope', () => {
  it('syncs balances without querying traditional relayers', async () => {
    const { manager, getRelayerData, getRelayerRegistryEvents } = await setup();

    await manager.sync();
    await manager.getBalances(undefined);

    expect(getRelayerRegistryEvents).not.toHaveBeenCalled();
    expect(getRelayerData).not.toHaveBeenCalled();
  });

  it('prepares paymaster withdrawals without querying traditional relayers', async () => {
    const { manager, getRelayerData, getRelayerRegistryEvents } = await setup();

    await manager.sync();
    await expect(manager.getWithdrawalPayloads({ mode: 'paymaster', asset: 0n, recipient: 1n })).resolves.toEqual([]);

    expect(getRelayerRegistryEvents).not.toHaveBeenCalled();
    expect(getRelayerData).not.toHaveBeenCalled();
  });

  it('syncs relayers on demand for a traditional relayer withdrawal', async () => {
    const { manager, getRelayerRegistryEvents } = await setup();

    await expect(manager.getWithdrawalPayloads({ mode: 'relayer', asset: 0n, recipient: 1n })).rejects.toMatchObject({ message: 'relayer registry unavailable' });
    expect(getRelayerRegistryEvents).toHaveBeenCalledTimes(1);

    getRelayerRegistryEvents.mockResolvedValue({ RelayerRegistered: [], fromBlock: 0n, toBlock: 100n });
    await expect(manager.getWithdrawalPayloads({ mode: 'relayer', asset: 0n, recipient: 1n })).resolves.toEqual([]);

    expect(getRelayerRegistryEvents).toHaveBeenCalledTimes(2);
    expect(Object.values(manager.dumpState())[0]?.sync.relayerRegistrySyncedBlock).toBe('0x64');
  });
});
