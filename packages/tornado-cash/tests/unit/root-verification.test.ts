import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { verifyStateRootOnChain } from '../../src/verification/root-verification';

// verifyStateRootOnChain checks getLastRoot() first and otherwise defers to the
// pool's own isKnownRoot(), which walks the contract's root history buffer.
describe('verifyStateRootOnChain', () => {
  const poolAddress = 222n as Address;

  function dataServiceWith(
    getPoolStateRoot: () => Promise<bigint>,
    isPoolRootValid: () => Promise<boolean> = async () => {
      throw new Error('unexpected isKnownRoot call');
    },
  ) {
    const dataService = {
      getPoolStateRoot: vi.fn(getPoolStateRoot),
      isPoolRootValid: vi.fn(isPoolRootValid),
    };

    return { dataService, asService: dataService as unknown as IDataService };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an empty expected root before making any RPC calls', async () => {
    const { dataService, asService } = dataServiceWith(async () => 1n);

    await expect(
      verifyStateRootOnChain({ dataService: asService, poolAddress, expectedRoot: 0n }),
    ).rejects.toThrow('State root verification called with empty root (0n)');

    expect(dataService.getPoolStateRoot).not.toHaveBeenCalled();
    expect(dataService.isPoolRootValid).not.toHaveBeenCalled();
  });

  it('returns without a history lookup when the current on-chain root matches', async () => {
    const { dataService, asService } = dataServiceWith(async () => 555n);

    await expect(
      verifyStateRootOnChain({ dataService: asService, poolAddress, expectedRoot: 555n }),
    ).resolves.toBeUndefined();

    expect(dataService.getPoolStateRoot).toHaveBeenCalledWith(poolAddress);
    expect(dataService.isPoolRootValid).not.toHaveBeenCalled();
  });

  it('accepts an older root that the pool still reports as known', async () => {
    const { dataService, asService } = dataServiceWith(async () => 111n, async () => true);

    await expect(
      verifyStateRootOnChain({ dataService: asService, poolAddress, expectedRoot: 777n }),
    ).resolves.toBeUndefined();

    expect(dataService.isPoolRootValid).toHaveBeenCalledTimes(1);
    expect(dataService.isPoolRootValid).toHaveBeenCalledWith(poolAddress, 777n);
  });

  it('throws when the pool does not know the root', async () => {
    const { dataService, asService } = dataServiceWith(async () => 111n, async () => false);

    await expect(
      verifyStateRootOnChain({ dataService: asService, poolAddress, expectedRoot: 999n }),
    ).rejects.toThrow(
      'State root verification failed: root not found in Pool recent history (expected=999, currentOnChain=111)',
    );

    expect(dataService.isPoolRootValid).toHaveBeenCalledWith(poolAddress, 999n);
  });

  it('propagates RPC errors from getPoolStateRoot', async () => {
    const { dataService, asService } = dataServiceWith(async () => {
      throw new Error('connection refused');
    });

    await expect(
      verifyStateRootOnChain({ dataService: asService, poolAddress, expectedRoot: 123n }),
    ).rejects.toThrow('connection refused');

    expect(dataService.isPoolRootValid).not.toHaveBeenCalled();
  });

  it('propagates RPC errors from isPoolRootValid instead of accepting the root', async () => {
    const { asService } = dataServiceWith(async () => 111n, async () => {
      throw new Error('execution reverted');
    });

    await expect(
      verifyStateRootOnChain({ dataService: asService, poolAddress, expectedRoot: 123n }),
    ).rejects.toThrow('execution reverted');
  });
});
