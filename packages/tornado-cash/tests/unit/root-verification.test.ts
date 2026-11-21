import { describe, expect, it, vi } from 'vitest';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { verifyStateRootOnChain } from '../../src/verification/root-verification';

const poolAddress = 222n as Address;

const makeDataService = () => ({
  getPoolStateRoot: vi.fn<IDataService['getPoolStateRoot']>().mockResolvedValue(111n),
  isPoolRootValid: vi.fn<IDataService['isPoolRootValid']>().mockResolvedValue(false),
});

describe('verifyStateRootOnChain', () => {
  it('rejects an empty expected root before making any RPC calls', async () => {
    const dataService = makeDataService();

    await expect(
      verifyStateRootOnChain({ dataService: dataService as unknown as IDataService, poolAddress, expectedRoot: 0n }),
    ).rejects.toThrow('State root verification called with empty root (0n)');

    expect(dataService.getPoolStateRoot).not.toHaveBeenCalled();
    expect(dataService.isPoolRootValid).not.toHaveBeenCalled();
  });

  it('returns immediately when the current on-chain root matches', async () => {
    const dataService = makeDataService();

    dataService.getPoolStateRoot.mockResolvedValue(555n);

    await expect(
      verifyStateRootOnChain({ dataService: dataService as unknown as IDataService, poolAddress, expectedRoot: 555n }),
    ).resolves.toBeUndefined();

    expect(dataService.getPoolStateRoot).toHaveBeenCalledWith(poolAddress);
    expect(dataService.isPoolRootValid).not.toHaveBeenCalled();
  });

  it('accepts a historical root recognized by the pool contract', async () => {
    const dataService = makeDataService();

    dataService.isPoolRootValid.mockResolvedValue(true);

    await expect(
      verifyStateRootOnChain({ dataService: dataService as unknown as IDataService, poolAddress, expectedRoot: 777n }),
    ).resolves.toBeUndefined();

    expect(dataService.isPoolRootValid).toHaveBeenCalledExactlyOnceWith(poolAddress, 777n);
  });

  it('rejects a root not recognized by the pool contract', async () => {
    const dataService = makeDataService();

    await expect(
      verifyStateRootOnChain({ dataService: dataService as unknown as IDataService, poolAddress, expectedRoot: 999n }),
    ).rejects.toThrow('State root verification failed: root not found in Pool recent history');

    expect(dataService.isPoolRootValid).toHaveBeenCalledExactlyOnceWith(poolAddress, 999n);
  });

  it('propagates RPC errors from getPoolStateRoot', async () => {
    const dataService = makeDataService();

    dataService.getPoolStateRoot.mockRejectedValue(new Error('connection refused'));

    await expect(
      verifyStateRootOnChain({ dataService: dataService as unknown as IDataService, poolAddress, expectedRoot: 123n }),
    ).rejects.toThrow('connection refused');

    expect(dataService.isPoolRootValid).not.toHaveBeenCalled();
  });

  it('propagates RPC errors while checking a historical root', async () => {
    const dataService = makeDataService();

    dataService.isPoolRootValid.mockRejectedValue(new Error('connection refused'));

    await expect(
      verifyStateRootOnChain({ dataService: dataService as unknown as IDataService, poolAddress, expectedRoot: 777n }),
    ).rejects.toThrow('connection refused');
  });
});
