import type { Storage } from '@kohaku-eth/plugins';
import { expect, it, vi } from 'vitest';

import { parseLegacyNote } from '../../src/account/legacyNote';
import { TornadoCashConfigs } from '../../src/config';
import type { Address } from '../../src/interfaces/types.interface';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { addLegacyUserSecret } from '../../src/state/slices/legacySecretsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { storeStateManager, type StoreFactoryParams } from '../../src/state/state-manager';
import { storeFactory } from '../../src/state/store';

it('ignores checkpoint secrets but preserves imported notes in private storage across restarts', async () => {
  const note = `tornado-dai-100-1-0x${'11'.repeat(62)}`;
  const { commitment, nullifier, nullifierHash, salt } = parseLegacyNote(note);
  const pool = 0xD4B88Df4D29F5CedD6857912842cff3b20C8Cfa3n as Address;
  const asset = 0x6B175474E89094C44Da98b954EedeAC495271d0Fn as Address;
  const config = TornadoCashConfigs[1];
  const storageKey = `tornado-cash-state-1-${config.instanceRegistry.address}`;
  const source = storeFactory({ protocolConfig: { ...config, chainId: 1n }, logLevel: 'off' });

  source.dispatch(registerPools([{
    address: pool, asset, denomination: 100n * 10n ** 18n, isERC20: true,
    protocolFeePercentage: 0, registeredBlock: 0n, state: 1, rootHistorySize: 100,
  }]));
  source.dispatch(registerDeposits([{
    pool, commitment, leafIndex: 0, timestamp: 1n, blockNumber: 1n, transactionHash: 1n,
  }]));
  source.dispatch(addLegacyUserSecret({ poolAddress: pool, record: { commitment, nullifier, nullifierHash, salt } }));

  const snapshot = source.getState();
  const initialState = vi.fn(async () => ({
    [storageKey]: {
      ...snapshot,
      userSecrets: snapshot.legacySecrets,
      signatureSecrets: snapshot.legacySecrets,
    },
  }));
  const saved = new Map<string, string>();
  const storage: Storage = {
    _brand: 'Storage',
    get: async (key) => saved.get(key) ?? null,
    set: async (key, value) => { saved.set(key, value); },
  };
  const params = {
    secretManagerFactory: async () => ({}),
    dataService: { getChainId: async () => 1n },
    syncService: {}, relayerClient: {}, paymasterConfig: {},
    proverFactory: async () => ({}), protocolConfig: config,
    storageToSyncTo: storage, initialState,
  } as unknown as StoreFactoryParams;
  const manager = await storeStateManager(params);

  expect(await manager.getNotes({})).toEqual([]);
  expect(manager.dumpState()[storageKey].deposits).toEqual(snapshot.deposits);
  expect(await manager.importNotes({ notes: [note] })).toEqual([{ note, status: 'imported', poolAddress: pool }]);
  expect(JSON.parse(saved.get(storageKey)!).legacySecrets).toEqual(snapshot.legacySecrets);

  const restarted = await storeStateManager(params);

  expect(await restarted.getNotes({})).toEqual([expect.objectContaining({ commitment, depositIndex: -1 })]);
  expect(initialState).toHaveBeenCalledTimes(1);

  const publicState = restarted.dumpState()[storageKey];

  for (const key of ['legacySecrets', 'userSecrets', 'signatureSecrets']) {
    expect(publicState).not.toHaveProperty(key);
  }
});
