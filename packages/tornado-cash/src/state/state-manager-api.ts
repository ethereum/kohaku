import { EthereumProvider, TxData } from '@kohaku-eth/provider';
import type { Storage, Keystore } from '@kohaku-eth/plugins';
import { ISecretManager, SecretManager } from '../account/keys';
import { SignatureSecretManager } from '../account/signature-keys';
import { DataService } from '../data/data.service';
import { SyncService } from '../data/sync.service';
import { ExternalSyncClient } from '../data/interfaces/sync.service.interface';
import { IRelayerClient } from '../relayer/interfaces/relayer-client.interface';
import { makeLazyProverFactory } from '../utils/prover-factory';
import { storeStateManager } from './state-manager';
import {
  IStateManager,
  IDepositOperationParams,
  IGetNotesParams,
  IPaymasterWithdrawParams,
  IWithdrawapOperationParams,
  IWithdrawalPayload,
  StoreStorageKey,
  TCProtocolConfig,
  IChainsPaymastersConfig,
  ITornadoArtifacts,
} from '../plugin/interfaces/protocol-params.interface';
import { PublicRootState } from './store';
import { Address } from '../interfaces/types.interface';
import { IRelayerFeeConfig } from './slices/relayersSlice';

export interface WorkerInitOptions {
  protocolConfig: TCProtocolConfig,
  relayerConfig?: IRelayerFeeConfig,
  accountIndex: number,
  paymasterConfig: IChainsPaymastersConfig,
  minExternalSyncBlocksAmount?: number,
}

async function defaultSecretManager(keystore: Keystore, accountIndex: number): Promise<ISecretManager> {
  const params = { host: { keystore }, accountIndex };
  const legacy = await SecretManager(params);
  const signature = await SignatureSecretManager(params);

  return { ...legacy, ...signature };
}

let _stateManager: IStateManager | null = null;

export function getStateManager(): IStateManager {
  if (!_stateManager) throw new Error('Worker not initialized — call init() first');

  return _stateManager;
}

// Host interfaces are passed as separate top-level arguments so Comlink's transfer
// handlers process them individually (nested objects inside a plain object bypass the
// handler and fail structured clone). Each one is a host-bridge remote: only the methods
// allowlisted in plugin/worker-host-policy.ts are callable.
export const workerApi = {
  async init(
    provider: EthereumProvider,
    relayerClient: IRelayerClient,
    keystore: Keystore,
    rawStorage: Omit<Storage, '_brand'>,
    initialState: () => Promise<Record<string, PublicRootState>>,
    artifactsLoader: () => Promise<ITornadoArtifacts>,
    secretManager: ISecretManager | undefined,
    externalSyncProvider: ExternalSyncClient | undefined,
    { protocolConfig, accountIndex, relayerConfig, paymasterConfig, minExternalSyncBlocksAmount }: WorkerInitOptions,
  ): Promise<void> {
    const storage = rawStorage as Storage;
    const dataService = new DataService({ provider });

    _stateManager = await storeStateManager({
      paymasterConfig,
      secretManagerFactory: () => secretManager
        ? Promise.resolve(secretManager)
        : defaultSecretManager(keystore, accountIndex),
      dataService,
      provider,
      syncService: new SyncService({ dataService, externalSyncProvider, minExternalSyncBlocksAmount }),
      relayerClient,
      proverFactory: makeLazyProverFactory(artifactsLoader),
      storageToSyncTo: storage,
      protocolConfig,
      relayerConfig,
      initialState,
    });
  },

  sync(): Promise<void> {
    return getStateManager().sync();
  },

  getBalances(assets?: Address[]): Promise<Map<Address, bigint>> {
    return getStateManager().getBalances(assets) as Promise<Map<Address, bigint>>;
  },

  getNotes(params: IGetNotesParams) {
    return getStateManager().getNotes(params);
  },

  getDepositPayload(params: IDepositOperationParams): Promise<TxData[]> {
    return getStateManager().getDepositPayload(params);
  },

  importNotes(params: { notes: string[] }) {
    return getStateManager().importNotes(params);
  },

  getWithdrawalPayloads(params: IWithdrawapOperationParams, tailCalls?: IPaymasterWithdrawParams['tailCalls'], bundlerPost?: IPaymasterWithdrawParams['bundlerPost']): Promise<IWithdrawalPayload[]> {
    const fullParams: IWithdrawapOperationParams = params.mode === 'paymaster'
      ? { ...params, tailCalls, bundlerPost }
      : params;

    return getStateManager().getWithdrawalPayloads(fullParams);
  },

  dumpState(): Record<StoreStorageKey, PublicRootState> {
    return getStateManager().dumpState();
  },
};

export type WorkerApi = typeof workerApi;
