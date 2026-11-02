import type { EthereumProvider } from '@kohaku-eth/provider';
import { decodeFunctionData, encodeFunctionResult, toHex, type Hex } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { TornadoCashConfigs } from '../../src/config';
import { aggregatorAbi } from '../../src/data/abis/aggregator.abi';
import { DataService } from '../../src/data/data.service';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { ISyncService } from '../../src/data/interfaces/sync.service.interface';
import { storeFactory } from '../../src/state/store';
import { syncRelayersThunk } from '../../src/state/thunks/syncRelayersThunk';

describe('relayer aggregator RPC', () => {
  it('looks up relayers in ordered batches of at most 16', async () => {
    const batchSizes: number[] = [];
    const request = vi.fn(async (rpc: { method: string; params: unknown[] }) => {
      expect(rpc.method).toBe('eth_call');
      const [{ data }] = rpc.params as [{ data: Hex }, string];
      const { args: [hashes, subdomains] } = decodeFunctionData({ abi: aggregatorAbi, data });

      batchSizes.push(hashes.length);
      expect(subdomains).toEqual(['mainnet-tornado']);

      return encodeFunctionResult({
        abi: aggregatorAbi,
        functionName: 'relayersData',
        result: hashes.map((hash) => ({
          owner: toHex(BigInt(hash), { size: 20 }),
          balance: BigInt(hash),
          isRegistered: true,
          records: Array(20).fill(''),
        })) as never,
      });
    });
    const service = new DataService({ provider: { request } as unknown as EthereumProvider });

    const relayers = await service.getRelayerData(
      1n,
      Array.from({ length: 33 }, (_, i) => BigInt(i + 1)),
      ['mainnet-tornado'],
    );

    expect(batchSizes).toEqual([16, 16, 1]);
    expect(relayers.map(({ owner }) => owner)).toEqual(Array.from({ length: 33 }, (_, i) => BigInt(i + 1)));
    expect(relayers[32]?.records).toHaveLength(20);
  });

  it('retries the same relayer events after an aggregator failure', async () => {
    const store = storeFactory({
      protocolConfig: { ...TornadoCashConfigs[1], chainId: 1n },
      logLevel: 'off',
    });
    const getRelayerRegistryEvents = vi.fn(async ({ fromBlock }: { fromBlock: bigint }) => ({
      RelayerRegistered: [{
        relayer: 1n,
        ensName: 'relayer.eth',
        relayerAddress: 1n,
        stakedAmount: 40n * 10n ** 18n,
        blockNumber: 100n,
        transactionHash: 1n,
      }],
      fromBlock,
      toBlock: 100n,
    }));
    const getRelayerData = vi.fn()
      .mockRejectedValueOnce(new Error('temporary RPC failure'))
      .mockResolvedValueOnce([{
        owner: 1n,
        balance: 40n * 10n ** 18n,
        isRegistered: true,
        records: ['relay.example'],
      }]);
    const params = {
      dataService: { getRelayerData } as unknown as IDataService,
      syncService: { getRelayerRegistryEvents } as unknown as ISyncService,
    };

    const first = await store.dispatch(syncRelayersThunk(params));

    expect(first.meta.requestStatus).toBe('rejected');
    expect(store.getState().sync.relayerRegistrySyncedBlock).toBe('0');

    const second = await store.dispatch(syncRelayersThunk(params));

    expect(second.meta.requestStatus).toBe('fulfilled');
    expect(getRelayerRegistryEvents).toHaveBeenCalledTimes(2);
    expect(getRelayerRegistryEvents.mock.calls[0]?.[0].fromBlock).toBe(getRelayerRegistryEvents.mock.calls[1]?.[0].fromBlock);
    expect(store.getState().sync.relayerRegistrySyncedBlock).toBe(toHex(100n));
    expect(store.getState().relayers.relayersTuples).toHaveLength(1);
  });
});
