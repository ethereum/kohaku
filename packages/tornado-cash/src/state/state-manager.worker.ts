/// <reference lib="webworker" />
import * as Comlink from 'comlink';

import { EthereumProvider, TxData } from '@kohaku-eth/provider';
import type { Network, Storage, Keystore } from '@kohaku-eth/plugins';
import { SecretManager } from '../account/keys';
import { DataService } from '../data/data.service';
import { RelayerClient } from '../relayer/relayer-client';
import { createTornadoProver } from '../utils/tornado-prover';
import { storeStateManager } from './state-manager';
import {
  IInstanceRegistry,
  IStateManager,
  IDepositOperationParams,
  IWithdrawapOperationParams,
  IWithdrawalPayload,
  StoreStorageKey,
} from '../plugin/interfaces/protocol-params.interface';
import { RootState } from './store';
import { Address } from '../interfaces/types.interface';

self.addEventListener('error', (e) => {
  console.error('[worker] uncaught error', e.message, e.filename, e.lineno, e.error);
});
self.addEventListener('unhandledrejection', (e) => {
  console.error('[worker] unhandled rejection', e.reason);
});

let _stateManager: IStateManager | null = null;

function getStateManager(): IStateManager {
  if (!_stateManager) throw new Error('Worker not initialized — call init() first');

  return _stateManager;
}

const workerApi = {
  // Each proxied host interface is passed as a separate top-level argument so Comlink's
  // transfer handlers process them individually (nested proxy objects inside a plain object
  // bypass the handler and fail structured clone).
  async init(
    provider: EthereumProvider,
    network: Network,
    keystore: Keystore,
    rawStorage: Omit<Storage, '_brand'>,
    instanceRegistry: IInstanceRegistry,
    accountIndex: number,
    initialState: Record<string, RootState>,
    proverWasm: ArrayBuffer,
    proverZkey: ArrayBuffer,
  ): Promise<void> {
    const storage = rawStorage as Storage;

    _stateManager = await storeStateManager({
      secretManagerFactory: () => SecretManager({ host: { keystore, provider, network, storage }, accountIndex }),
      dataService: new DataService({ provider }),
      relayerClient: new RelayerClient({ network }),
      proverFactory: () => Promise.resolve(createTornadoProver(new Uint8Array(proverWasm), new Uint8Array(proverZkey))),
      storageToSyncTo: storage,
      instanceRegistry,
      initialState,
    });
  },

  sync(): Promise<void> {
    return getStateManager().sync();
  },

  getBalances(assets?: Address[]): Promise<Map<Address, bigint>> {
    return getStateManager().getBalances(assets) as Promise<Map<Address, bigint>>;
  },

  getDepositPayload(params: IDepositOperationParams): Promise<TxData[]> {
    return getStateManager().getDepositPayload(params);
  },

  getWithdrawalPayloads(params: IWithdrawapOperationParams): Promise<IWithdrawalPayload[]> {
    return getStateManager().getWithdrawalPayloads(params);
  },

  dumpState(): Record<StoreStorageKey, RootState> {
    return getStateManager().dumpState();
  },
};

export type WorkerApi = typeof workerApi;

console.log('about to expose')

Comlink.expose(workerApi);
