import { unwrapResult } from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';

import { TornadoCashConfigs, extendedEthPoolSet } from '../../src/config';
import { IDataService, IPoolConfig } from '../../src/data/interfaces/data.service.interface';
import { ISyncService } from '../../src/data/interfaces/sync.service.interface';
import { Address } from '../../src/interfaces/types.interface';
import { activePoolsSelector } from '../../src/state/selectors/slices.selectors';
import { storeFactory } from '../../src/state/store';
import { syncPoolsThunk } from '../../src/state/thunks/syncPoolsThunk';

const SEPOLIA_TEN_ETH = 0x8d10d506d29fc62abb8a290b99f66db27fc43585n as Address;

describe('canonical Sepolia 10 ETH pool discovery', () => {
  it.each([false, true])('is active by default when registry-listed = %s', async (registered) => {
    const store = storeFactory({
      protocolConfig: { ...TornadoCashConfigs[11155111], chainId: 11155111n },
      logLevel: 'off',
    });
    const config: IPoolConfig = {
      poolAddress: SEPOLIA_TEN_ETH,
      isERC20: false,
      token: 0n,
      state: 1,
      protocolFeePercentage: registered ? 33 : 0,
      denomination: 10n ** 19n,
      rootHistorySize: 30,
    };
    const dataService = {
      getAllPoolsAddresses: vi.fn().mockResolvedValue(registered ? [SEPOLIA_TEN_ETH] : []),
      getPoolConfig: vi.fn().mockResolvedValue(config),
      getUnregisteredNativeEthPoolConfig: vi.fn().mockResolvedValue(config),
    };
    const syncService = { getPoolDeploymentBlock: vi.fn().mockResolvedValue(5594402n) };
    const sync = () => store.dispatch(syncPoolsThunk({
      dataService: dataService as unknown as IDataService,
      syncService: syncService as unknown as ISyncService,
    }));

    unwrapResult(await sync());

    const pools = activePoolsSelector(store.getState());

    expect(pools.size).toBe(1);
    expect(pools.get(SEPOLIA_TEN_ETH)).toMatchObject({
      address: SEPOLIA_TEN_ETH,
      asset: 0n,
      isERC20: false,
      denomination: 10n ** 19n,
      registeredBlock: 5594402n,
      protocolFeePercentage: config.protocolFeePercentage,
    });
    expect(pools.get(SEPOLIA_TEN_ETH)?.extended).toBeUndefined();
    expect(extendedEthPoolSet(11155111n).has(SEPOLIA_TEN_ETH)).toBe(false);

    if (registered) {
      expect(dataService.getPoolConfig).toHaveBeenCalledWith(
        TornadoCashConfigs[11155111].instanceRegistry.address, SEPOLIA_TEN_ETH,
      );
      expect(dataService.getUnregisteredNativeEthPoolConfig).not.toHaveBeenCalled();
    } else {
      expect(dataService.getPoolConfig).not.toHaveBeenCalled();
      expect(dataService.getUnregisteredNativeEthPoolConfig).toHaveBeenCalledWith(SEPOLIA_TEN_ETH);
    }

    // A subsequent sync reuses the saved canonical pool.
    unwrapResult(await sync());
    expect(syncService.getPoolDeploymentBlock).toHaveBeenCalledTimes(1);
    expect(activePoolsSelector(store.getState()).get(SEPOLIA_TEN_ETH)?.extended).toBeUndefined();
  });
});
