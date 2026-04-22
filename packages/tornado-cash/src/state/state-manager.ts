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
import { ITornadoProver } from "../utils/tornado-prover";
import { ISecretManager } from "../account/keys";
import {
  specificAssetsBalanceSelector,
  SpecificAssetBalanceFn,
} from "./selectors/balance.selector";
import { poolFromAssetSelector } from "./selectors/pools.selector";
import { getWithdrawableDepositsSelector } from "./selectors/withdrawals.selector";
import { RootState, storeFactory } from "./store";
import { syncThunk } from "./thunks/syncThunk";
import { withdrawThunk } from "./thunks/withdrawThunk";
import { getDepositPayloadThunk } from "./thunks/getDepositPayloadThunk";
import { IDataService } from "../data/interfaces/data.service.interface";
import { DEFAULT_MAINNET_FEE_CONFIG, DEFAULT_OTHER_FEE_CONFIG, setRelayerFeeConfig } from "./slices/relayersSlice";

export interface StoreFactoryParams {
  secretManagerFactory: () => Promise<ISecretManager>;
  dataService: IDataService;
  relayerClient: IRelayerClient;
  storageToSyncTo?: Storage;
  instanceRegistry: IInstanceRegistry;
  proverFactory: () => Promise<ITornadoProver>;
  initialState?: () => Promise<Record<
    string,
    Parameters<typeof storeFactory>[0]["initialState"]
  >>;
}

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

const initializeSelectors = <const T extends Store>(store: T) => ({
  ...store,
  selectors: {
    specificAssetsBalanceSelector: ((assets: Address[] | Address | undefined) =>
      Promise.resolve(specificAssetsBalanceSelector(store.getState(), assets as Address[]))) as unknown as SpecificAssetBalanceFn<true>,
    getWithdrawableDeposits: (asset: Address, amount?: bigint) =>
      getWithdrawableDepositsSelector(store.getState(), asset, amount),
    poolFromAssetSelector: (assetAddress: Address) =>
      poolFromAssetSelector(store.getState(), assetAddress),
  },
  getPublicState: () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { userSecrets, ...publicState } = store.getState();

    return publicState;
  }
});

const storeByChainAndEntrypoint = ({
  storageToSyncTo,
  initialState: initialStateCallback,
}: Pick<StoreFactoryParams, 'storageToSyncTo' | 'initialState'>) => {

  // The callback returns the full record for all chains at once.
  // Cache it so multiple chains lacking stored state only trigger one fetch.
  let cachedInitialState: Awaited<ReturnType<NonNullable<StoreFactoryParams['initialState']>>> | undefined;

  const resolveInitialState = initialStateCallback
    ? async () => {
        if (!cachedInitialState) {
          cachedInitialState = await initialStateCallback();
        }

        return cachedInitialState;
      }
    : undefined;

  const chainStoreMap = new Map<
    StoreKey,
    ReturnType<typeof initializeSelectors<ReturnType<typeof storeFactory>>>
  >();

  return {
    getChainStore: async (getChainStoreParams: GetChainStoreParams) => {
      const {
        chainId,
        instanceRegistry: { address, deploymentBlock, relayerRegistry },
      } = getChainStoreParams;
      const computedChainKey = getStoreKey(getChainStoreParams);
      let storeWithSelectors = chainStoreMap.get(computedChainKey);

      if (!storeWithSelectors) {
        const storageKey = getStoreStorageKey(getChainStoreParams);
        const rawStoredState = storageToSyncTo ? await storageToSyncTo.get(storageKey) : undefined;
        const storedState: RootState | undefined = rawStoredState ? JSON.parse(rawStoredState) : undefined;
        const snapshotInitialState = storedState || !resolveInitialState
          ? undefined
          : (await resolveInitialState())[storageKey];
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

        storeWithSelectors = initializeSelectors(store);
        chainStoreMap.set(computedChainKey, storeWithSelectors);
      }

      return storeWithSelectors;
    },
    getAllStores: (): ReturnType<IStateManager['dumpState']> => {
      return Array.from(chainStoreMap).reduce(
        (completeState, [chainKey, state]) => {
          return {
            ...completeState,
            [`tornado-cash-state-${chainKey}`]: state.getPublicState()
          };
        },
        {} as ReturnType<IStateManager['dumpState']>,
      );
    },
  };
};

export const storeStateManager = async ({
  secretManagerFactory,
  dataService,
  relayerClient,
  proverFactory,
  storageToSyncTo,
  instanceRegistry,
  initialState,
}: StoreFactoryParams): Promise<IStateManager> => {
  const secretManager = await secretManagerFactory();
  const { getChainStore, getAllStores } = storeByChainAndEntrypoint({
    storageToSyncTo,
    initialState,
  });

  const getChainInfo = async () => ({
    chainId: await dataService.getChainId(),
    instanceRegistry,
  });

  return {
    sync: async (): Promise<void> => {
      const chainInfo = await getChainInfo();
      const store = await getChainStore(chainInfo);

      unwrapResult(
        await store.dispatch(
          syncThunk({
            dataService,
            relayerClient,
            secretManager,
            ...store.selectors,
          }),
        ),
      );

      if (storageToSyncTo) {
        await storageToSyncTo.set(
          getStoreStorageKey(chainInfo),
          JSON.stringify(store.getPublicState()),
        );
      }
    },
    getBalances: async (assets) => {
      const { selectors: { specificAssetsBalanceSelector } } =
        await getChainStore(await getChainInfo());

      return specificAssetsBalanceSelector(assets);
    },
    getDepositPayload: async ({ asset, amount }: IDepositOperationParams) => {
      const store = await getChainStore(await getChainInfo());

      return unwrapResult(
        await store.dispatch(
          getDepositPayloadThunk({ secretManager, asset, amount }),
        ),
      );
    },
    getWithdrawalPayloads: async ({
      asset,
      amount,
      recipient,
      preferredRelayersEns
    }: IWithdrawapOperationParams): Promise<IWithdrawalPayload[]> => {
      const store = await getChainStore(await getChainInfo());

      return unwrapResult(
        await store.dispatch(
          withdrawThunk({
            proverFactory,
            recipient,
            getWithdrawableDeposits: store.selectors.getWithdrawableDeposits,
            relayerClient,
            dataService,
            assetAddress: asset,
            amount,
            preferredRelayersEns: preferredRelayersEns ? new Set(preferredRelayersEns) : undefined
          }),
        ),
      );
    },
    dumpState: () => getAllStores(),
  };
};
