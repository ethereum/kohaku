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

  describe('verifyStateRootOnChain', () => {
    it('rejects an empty expected root before making any RPC calls', async () => {
      const dataService = {
        getPoolStateRoot: vi.fn(),
        getPoolCurrentRootIndex: vi.fn(),
        getPoolHistoricalRoot: vi.fn(),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain({ dataService, poolAddress, expectedRoot: 0n }),
      ).rejects.toThrow('State root verification called with empty root (0n)');

      expect(dataService.getPoolStateRoot).not.toHaveBeenCalled();
      expect(dataService.getPoolCurrentRootIndex).not.toHaveBeenCalled();
      expect(dataService.getPoolHistoricalRoot).not.toHaveBeenCalled();
    });

    it('returns immediately when the current on-chain root matches', async () => {
      const dataService = {
        getPoolStateRoot: vi.fn().mockResolvedValue(555n),
        getPoolCurrentRootIndex: vi.fn(),
        getPoolHistoricalRoot: vi.fn(),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain({ dataService, poolAddress, expectedRoot: 555n }),
      ).resolves.toBeUndefined();

      expect(dataService.getPoolStateRoot).toHaveBeenCalledWith(poolAddress);
      expect(dataService.getPoolCurrentRootIndex).not.toHaveBeenCalled();
      expect(dataService.getPoolHistoricalRoot).not.toHaveBeenCalled();
    });

    it('finds a historical root using the contract ring-buffer indices', async () => {
      const expectedRoot = 777n;
      const requestedIndices: number[] = [];
      const dataService = {
        getPoolStateRoot: vi.fn().mockResolvedValue(111n),
        getPoolCurrentRootIndex: vi.fn().mockResolvedValue(40),
        getPoolHistoricalRoot: vi.fn().mockImplementation(async (_pool: Address, index: number) => {
          requestedIndices.push(index);

          return index === 39 ? expectedRoot : 0n;
        }),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain({dataService, poolAddress, expectedRoot}),
      ).resolves.toBeUndefined();

      expect(requestedIndices).toEqual([39]);
    });

    it('wraps around the history buffer when the current index is zero', async () => {
      const expectedRoot = 888n;
      const requestedIndices: number[] = [];
      const dataService = {
        getPoolStateRoot: vi.fn().mockResolvedValue(111n),
        getPoolCurrentRootIndex: vi.fn().mockResolvedValue(0),
        getPoolHistoricalRoot: vi.fn().mockImplementation(async (_pool: Address, index: number) => {
          requestedIndices.push(index);

          return index === 63 ? expectedRoot : 0n;
        }),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain({dataService, poolAddress, expectedRoot}),
      ).resolves.toBeUndefined();

      expect(requestedIndices).toEqual([63]);
    });

    it('finds the root at the very last slot before exhaustion', async () => {
      const expectedRoot = 444n;
      const requestedIndices: number[] = [];
      const dataService = {
        getPoolStateRoot: vi.fn().mockResolvedValue(111n),
        getPoolCurrentRootIndex: vi.fn().mockResolvedValue(10),
        getPoolHistoricalRoot: vi.fn().mockImplementation(async (_pool: Address, index: number) => {
          requestedIndices.push(index);

          return index === 11 ? expectedRoot : 0n;
        }),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain({dataService, poolAddress, expectedRoot}),
      ).resolves.toBeUndefined();

      expect(requestedIndices).toHaveLength(63);
      expect(requestedIndices[requestedIndices.length - 1]).toBe(11);
    });

    it('throws when the root is not present in the recent on-chain history', async () => {
      const dataService = {
        getPoolStateRoot: vi.fn().mockResolvedValue(111n),
        getPoolCurrentRootIndex: vi.fn().mockResolvedValue(5),
        getPoolHistoricalRoot: vi.fn().mockResolvedValue(0n),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain({dataService, poolAddress, expectedRoot: 999n}),
      ).rejects.toThrow(
        'State root verification failed: root not found in Pool recent history',
      );

      expect(dataService.getPoolHistoricalRoot).toHaveBeenCalledTimes(63);
    });

    it('propagates RPC errors from getPoolStateRoot', async () => {
      const dataService = {
        getPoolStateRoot: vi.fn().mockRejectedValue(new Error('connection refused')),
        getPoolCurrentRootIndex: vi.fn(),
        getPoolHistoricalRoot: vi.fn(),
      } as unknown as IDataService;

      await expect(
        verifyStateRootOnChain({ dataService, poolAddress, expectedRoot: 123n }),
      ).rejects.toThrow('connection refused');

      expect(dataService.getPoolCurrentRootIndex).not.toHaveBeenCalled();
      expect(dataService.getPoolHistoricalRoot).not.toHaveBeenCalled();
    });
  });
});
