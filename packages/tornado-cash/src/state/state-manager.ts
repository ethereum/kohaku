/* eslint-disable max-lines */
import { ChainId, Storage } from "@kohaku-eth/plugins";
import { Store, unwrapResult } from "@reduxjs/toolkit";

import { Address } from "../interfaces/types.interface";
import {
  IDepositOperationParams,
  IInstanceRegistry,
  IStateManager,
  IWithdrawapOperationParams,
  StoreKey,
  StoreStorageKey,
  IWithdrawalPayload,
} from "../plugin/interfaces/protocol-params.interface";
import { IRelayerClient } from "../relayer/interfaces/relayer-client.interface";
import { DEFAULT_MAINNET_FEE_CONFIG, DEFAULT_OTHER_FEE_CONFIG, setRelayerFeeConfig } from "./slices/relayersSlice";
import { ITornadoProver } from "../utils/tornado-prover";
import {
  createAllAssetsBalanceSelector,
  createMyAssetsBalanceSelector,
  createMyDepositsBalanceSelector,
  createMyDepositsWithAssetSelector,
  createSpecificAssetBalanceSelector,
  SpecificAssetBalanceFn,
} from "./selectors/balance.selector";
import {
  createGetNextDepositsPayloadSelector,
  createMyDepositsSelector,
} from "./selectors/deposits.selector";
import { poolFromAssetSelector } from "./selectors/pools.selector";
import { createGetWithdrawableDepositsSelector, createMyWithdrawalsSelector } from "./selectors/withdrawals.selector";
import { RootState, storeFactory } from "./store";
import { syncThunk } from "./thunks/syncThunk";
import { withdrawThunk } from "./thunks/withdrawThunk";
import { IDataService } from "../data/interfaces/data.service.interface";
import { ISecretManager } from "../account/keys";

export interface StoreFactoryParams {
  secretManagerFactory: () => Promise<ISecretManager>
  dataService: IDataService;
  relayerClient: IRelayerClient;
  storageToSyncTo?: Storage;
  instanceRegistry: IInstanceRegistry;
  proverFactory: () => Promise<ITornadoProver>;
  initialState?: Record<
    string,
    Parameters<typeof storeFactory>[0]["initialState"]
  >;
}

type SelectorParams = Omit<StoreFactoryParams, 'dataService' | 'secretManagerFactory'> & {
  secretManager: ISecretManager
}

const initializeSelectors = <const T extends Store>({
  store,
  ...params
}: SelectorParams & { store: T; }) => {
  // We need to tie the selectors instances to a specific store
  // so they can memoize correctly
  const myDepositsSelector = createMyDepositsSelector(params);
  const myDepositsWithAssetSelector =
    createMyDepositsWithAssetSelector(myDepositsSelector);
  const myWithdrawalsSelector = createMyWithdrawalsSelector({
    myDepositsSelector,
    ...params,
  });

  const myDepositsBalanceSelector = createMyDepositsBalanceSelector({
    myDepositsWithAssetSelector,
    myWithdrawalsSelector,
  });
  const myAssetsBalanceSelector = createMyAssetsBalanceSelector({
    myDepositsBalanceSelector,
  });

  const getNextPoolDepositsPayloadSelector = createGetNextDepositsPayloadSelector({
    myDepositsSelector,
    secretsManager: params.secretManager,
  });

  const getWithdrawableDepositsSelector = createGetWithdrawableDepositsSelector({
    myDepositsSelector,
    secretsManager: params.secretManager,
  });

  const allAssetsBalanceSelector = createAllAssetsBalanceSelector(myAssetsBalanceSelector);
  const specificAssetsBalanceSelector = createSpecificAssetBalanceSelector(allAssetsBalanceSelector);


  return {
    ...store,
    selectors: {
      myAssetsBalanceSelector: () => myAssetsBalanceSelector(store.getState()),
      specificAssetsBalanceSelector: ((addresses: Address[]) => specificAssetsBalanceSelector(store.getState(), addresses)) as SpecificAssetBalanceFn,
      getNextDepositPayload: (asset: Address, amount: bigint) =>
        getNextPoolDepositsPayloadSelector(store.getState(), asset, amount),
      getWithdrawableDeposits: (asset: Address, amount?: bigint) =>
        getWithdrawableDepositsSelector(store.getState(), asset, amount),
      poolFromAssetSelector: (assetAddress: Address) => poolFromAssetSelector(store.getState(), assetAddress),
    },
  };
};

interface GetChainStoreParams {
  chainId: ChainId;
  instanceRegistry: IInstanceRegistry;
}

const getStoreKey = ({
  chainId,
  instanceRegistry: { address },
}: GetChainStoreParams): StoreKey => `${chainId.toString()}-${address}`;

const getStoreStorageKey = (
  params: GetChainStoreParams,
): StoreStorageKey => `tornado-cash-state-${getStoreKey(params)}`;

const storeByChainAndEntrypoint = ({
  storageToSyncTo,
  initialState: initialStateByChainAndEntrypoint = {},
  ...params
}: SelectorParams) => {

  const chainStoreMap = new Map<
    StoreKey,
    ReturnType<typeof initializeSelectors<ReturnType<typeof storeFactory>>>
  >();

  return {
    getChainStore: (getChainStoreParams: GetChainStoreParams) => {
      const {
        chainId,
        instanceRegistry: { address, deploymentBlock, relayerRegistry },
      } = getChainStoreParams;
      const computedChainKey = getStoreKey(getChainStoreParams);
      let storeWithSelectors = chainStoreMap.get(computedChainKey);

      if (!storeWithSelectors) {
        const storageKey = getStoreStorageKey(getChainStoreParams);
        const rawStoredState = storageToSyncTo?.get(storageKey);
        const storedState: RootState | undefined = rawStoredState ? JSON.parse(rawStoredState) : undefined;
        const snapshotInitialState = initialStateByChainAndEntrypoint[storageKey];
        const initialState: RootState | undefined = storedState || snapshotInitialState;
        const store = storeFactory({
          instanceRegsitryInfo: {
            chainId,
            instanceRegistryAddress: address,
            deploymentBlock,
            relayerRegistryAddress: relayerRegistry.address,
            relayerRegistryDeploymentBlock: relayerRegistry.deploymentBlock,
            aggregatorAddress: relayerRegistry.aggregatorAddress,
            ensSubdomainKey: relayerRegistry.ensSubdomainKey,
          },
          initialState,
        });

        const feeConfig = relayerRegistry.feeConfig
          ?? (chainId === 1n ? DEFAULT_MAINNET_FEE_CONFIG : DEFAULT_OTHER_FEE_CONFIG);

        store.dispatch(setRelayerFeeConfig(feeConfig));

        storeWithSelectors = initializeSelectors({ ...params, store });
        chainStoreMap.set(computedChainKey, storeWithSelectors);
      }

      return storeWithSelectors;
    },
    getAllStores: (): ReturnType<IStateManager['dumpState']> => {
      return Array.from(chainStoreMap).reduce(
        (completeState, [chainKey, state]) => ({
          ...completeState,
          [`tornado-cash-state-${chainKey}`]: state.getState(),
        }),
        {} as ReturnType<IStateManager['dumpState']>,
      );
    },
  };
};

export const storeStateManager = async (
  { secretManagerFactory, ...params }: StoreFactoryParams,
): Promise<IStateManager> => {
  const secretManager = await secretManagerFactory();
  const { getChainStore, getAllStores } = storeByChainAndEntrypoint({...params, secretManager});
  const { storageToSyncTo } = params;

  const getChainInfo = async () => ({
    chainId: await params.dataService.getChainId(),
    instanceRegistry: params.instanceRegistry
  });

  return {
    sync: async (): Promise<void> => {
      const chainInfo = await getChainInfo();

      const store = getChainStore(chainInfo);

      unwrapResult(
        await store.dispatch(
          syncThunk({
            ...params,
            ...store.selectors,
          }),
        ),
      );

      if (storageToSyncTo) {
        storageToSyncTo.set(
          getStoreStorageKey(chainInfo),
          JSON.stringify(store.getState()),
        );
      }
    },
    getBalances: async (
      assets,
    ) => {
      const {
        selectors: {
          specificAssetsBalanceSelector,
        },
      } = getChainStore(await getChainInfo());

      return specificAssetsBalanceSelector(assets);
    },
    getDepositPayload: async ({
      asset,
      amount,
    }: IDepositOperationParams) => {
      const store = getChainStore(await getChainInfo());

      return store.selectors.getNextDepositPayload(asset, amount);
    },
    getWithdrawalPayloads: async ({
      asset,
      amount,
      recipient,
    }: IWithdrawapOperationParams): Promise<IWithdrawalPayload[]> => {
      const chainInfo = await getChainInfo();
      const store = getChainStore(chainInfo);

      const withdrawResultAction = await store.dispatch(
        withdrawThunk({
          proverFactory: params.proverFactory,
          recipient,
          getWithdrawableDeposits: store.selectors.getWithdrawableDeposits,
          relayerClient: params.relayerClient,
          assetAddress: asset,
          amount
        }),
      );

      return unwrapResult(withdrawResultAction)
    },
    dumpState: () => getAllStores(),
  };
};
