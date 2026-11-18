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
        verifyAspRootOnChain(dataService, entrypointAddress, 0n),
      ).rejects.toThrow('ASP root verification called with empty root (0n)');

      expect(dataService.getEntrypointLatestRoot).not.toHaveBeenCalled();
    });

    it('accepts the latest entrypoint root', async () => {
      const dataService = {
        getEntrypointLatestRoot: vi.fn().mockResolvedValue(123n),
      } as unknown as IDataService;

      await expect(
        verifyAspRootOnChain(dataService, entrypointAddress, 123n),
      ).resolves.toBeUndefined();

      expect(dataService.getEntrypointLatestRoot).toHaveBeenCalledWith(entrypointAddress);
    });

    it('throws when the expected ASP root is not the latest on-chain root', async () => {
      const dataService = {
        getEntrypointLatestRoot: vi.fn().mockResolvedValue(321n),
      } as unknown as IDataService;

      await expect(
        verifyAspRootOnChain(dataService, entrypointAddress, 123n),
      ).rejects.toThrow(
        'ASP root verification failed: expected root does not match Entrypoint latestRoot',
      );
    });

    it('propagates RPC errors from the data service', async () => {
      const dataService = {
        getEntrypointLatestRoot: vi.fn().mockRejectedValue(new Error('RPC timeout')),
      } as unknown as IDataService;

      await expect(
        verifyAspRootOnChain(dataService, entrypointAddress, 123n),
      ).rejects.toThrow('RPC timeout');
    });
  });

  describe('verifyStateRootOnChain', () => {
    const syncedBlock = 120n;

    it('rejects an empty expected root before making any RPC calls', async () => {
      const dataService = {
        getPoolStateRoot: vi.fn(),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain(dataService, poolAddress, 0n, syncedBlock),
      ).rejects.toThrow('State root verification called with empty root (0n)');

      expect(dataService.getPoolStateRoot).not.toHaveBeenCalled();
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
        getPoolCurrentRootIndex: vi.fn().mockResolvedValue(40),
        getPoolHistoricalRoot: vi.fn().mockResolvedValue(777n),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain(dataService, poolAddress, 777n, syncedBlock),
      ).rejects.toThrow(
        'State root verification failed: root does not match Pool currentRoot at the synced block',
      );

      expect(dataService.getPoolCurrentRootIndex).not.toHaveBeenCalled();
      expect(dataService.getPoolHistoricalRoot).not.toHaveBeenCalled();
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
