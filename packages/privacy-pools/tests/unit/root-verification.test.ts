import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import {
  verifyAspRootOnChain,
  verifyStateRootOnChain,
} from '../../src/verification/root-verification';

describe('root verification', () => {
  const entrypointAddress = 111n as Address;
  const poolAddress = 222n as Address;
  const syncedBlock = 120n;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('verifyAspRootOnChain', () => {
    it('rejects an empty expected root before making any RPC calls', async () => {
      const dataService = {
        getEntrypointLatestRoot: vi.fn(),
      } as unknown as IDataService;

      await expect(
        verifyAspRootOnChain(dataService, entrypointAddress, 0n, syncedBlock),
      ).rejects.toThrow('ASP root verification called with empty root (0n)');

      expect(dataService.getEntrypointLatestRoot).not.toHaveBeenCalled();
    });

    it('accepts the entrypoint root at the synced block', async () => {
      const dataService = {
        getEntrypointLatestRoot: vi.fn().mockResolvedValue(123n),
      } as unknown as IDataService;

      await expect(
        verifyAspRootOnChain(dataService, entrypointAddress, 123n, syncedBlock),
      ).resolves.toBeUndefined();

      expect(dataService.getEntrypointLatestRoot).toHaveBeenCalledWith(entrypointAddress, syncedBlock);
    });

    it('is not failed by a root posted after the synced block', async () => {
      // The tree is the last RootUpdated scanned; a newer root at latest is not its concern.
      const dataService = {
        getEntrypointLatestRoot: vi.fn(async (_address: Address, block?: bigint) =>
          block === syncedBlock ? 123n : 456n),
      } as unknown as IDataService;

      await expect(
        verifyAspRootOnChain(dataService, entrypointAddress, 123n, syncedBlock),
      ).resolves.toBeUndefined();
    });

    it('throws when the expected ASP root is not the latest on-chain root', async () => {
      const dataService = {
        getEntrypointLatestRoot: vi.fn().mockResolvedValue(321n),
      } as unknown as IDataService;

      await expect(
        verifyAspRootOnChain(dataService, entrypointAddress, 123n, syncedBlock),
      ).rejects.toThrow(
        'ASP root verification failed: expected root does not match Entrypoint latestRoot at the synced block',
      );
    });

    it('propagates RPC errors from the data service', async () => {
      const dataService = {
        getEntrypointLatestRoot: vi.fn().mockRejectedValue(new Error('RPC timeout')),
      } as unknown as IDataService;

      await expect(
        verifyAspRootOnChain(dataService, entrypointAddress, 123n, syncedBlock),
      ).rejects.toThrow('RPC timeout');
    });
  });

  describe('verifyStateRootOnChain', () => {
    it('accepts an empty tree only when the pool is empty at the synced block', async () => {
      const dataService = {
        getPoolStateRoot: vi.fn().mockResolvedValueOnce(0n).mockResolvedValueOnce(555n),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain(dataService, poolAddress, 0n, syncedBlock),
      ).resolves.toBeUndefined();
      await expect(
        verifyStateRootOnChain(dataService, poolAddress, 0n, syncedBlock),
      ).rejects.toThrow('State root verification failed');

      expect(dataService.getPoolStateRoot).toHaveBeenCalledWith(poolAddress, syncedBlock);
    });

    it('accepts the current root read at the synced block', async () => {
      const dataService = {
        getPoolStateRoot: vi.fn().mockResolvedValue(555n),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain(dataService, poolAddress, 555n, syncedBlock),
      ).resolves.toBeUndefined();

      expect(dataService.getPoolStateRoot).toHaveBeenCalledWith(poolAddress, syncedBlock);
    });

    it('rejects a root that is only in the recent history', async () => {
      // A tree missing its newest leaves has an older, still-known root.
      const dataService = {
        getPoolStateRoot: vi.fn().mockResolvedValue(111n),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain(dataService, poolAddress, 777n, syncedBlock),
      ).rejects.toThrow(
        'State root verification failed: root does not match Pool currentRoot at the synced block',
      );
    });

    it('propagates RPC errors from getPoolStateRoot', async () => {
      const dataService = {
        getPoolStateRoot: vi.fn().mockRejectedValue(new Error('connection refused')),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain(dataService, poolAddress, 123n, syncedBlock),
      ).rejects.toThrow('connection refused');
    });
  });
});
