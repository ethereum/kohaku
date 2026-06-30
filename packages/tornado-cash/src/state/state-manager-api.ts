import { EthereumProvider, TxData } from '@kohaku-eth/provider';
import type { Storage, Keystore } from '@kohaku-eth/plugins';
import { SecretManager } from '../account/keys';
import { DataService } from '../data/data.service';
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
import { PublicRootState, RootState } from './store';
import { Address } from '../interfaces/types.interface';
import { IRelayerFeeConfig } from './slices/relayersSlice';

export interface WorkerInitOptions {
  protocolConfig: TCProtocolConfig,
  relayerConfig?: IRelayerFeeConfig,
  accountIndex: number,
  paymasterConfig: IChainsPaymastersConfig,
}

let _stateManager: IStateManager | null = null;

export function getStateManager(): IStateManager {
  if (!_stateManager) throw new Error('Worker not initialized — call init() first');

  return _stateManager;
}

// Proxied host interfaces are passed as separate top-level arguments so Comlink's
// transfer handlers process them individually (nested proxy objects inside a plain object
// bypass the handler and fail structured clone).
export const workerApi = {
  async init(
    provider: EthereumProvider,
    relayerClient: IRelayerClient,
    keystore: Keystore,
    rawStorage: Omit<Storage, '_brand'>,
    initialState: () => Promise<Record<string, PublicRootState>>,
    artifactsLoader: () => Promise<ITornadoArtifacts>,
    { protocolConfig, accountIndex, relayerConfig, paymasterConfig }: WorkerInitOptions,
  ): Promise<void> {
    const storage = rawStorage as Storage;

    _stateManager = await storeStateManager({
      paymasterConfig,
      secretManagerFactory: () => SecretManager({ host: { keystore }, accountIndex }),
      dataService: new DataService({ provider }),
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

  getWithdrawalPayloads(params: IWithdrawapOperationParams, tailCalls?: IPaymasterWithdrawParams['tailCalls']): Promise<IWithdrawalPayload[]> {
    const fullParams: IWithdrawapOperationParams = params.mode === 'paymaster' && tailCalls
      ? { ...params, tailCalls }
      : params;

    return getStateManager().getWithdrawalPayloads(fullParams);
  },

  dumpState(): Record<StoreStorageKey, Omit<RootState, 'userSecrets'>> {
    return getStateManager().dumpState();
  },
};

export type WorkerApi = typeof workerApi;
