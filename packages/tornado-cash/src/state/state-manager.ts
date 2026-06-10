/* eslint-disable max-lines */
import { ChainId, Storage } from "@kohaku-eth/plugins";
import { Store, unwrapResult } from "@reduxjs/toolkit";

import { Address } from "../interfaces/types.interface";
import {
  IDepositOperationParams,
  IStateManager,
  IWithdrawapOperationParams,
  StoreKey,
  StoreStorageKey,
  IWithdrawalPayload,
  TCProtocolConfig,
  IChainsPaymastersConfig,
} from "../plugin/interfaces/protocol-params.interface";
import { IRelayerClient } from "../relayer/interfaces/relayer-client.interface";
import { ITornadoProver } from "../utils/tornado-prover";
import { ISecretManager } from "../account/keys";
import {
  specificAssetsBalanceSelector,
  SpecificAssetBalanceFn,
} from "./selectors/balance.selector";
import { PublicRootState, storeFactory } from "./store";
import { syncThunk } from "./thunks/syncThunk";
import { withdrawThunk } from "./thunks/withdrawThunk";
import { paymasterWithdrawThunk } from "./thunks/paymasterWithdrawThunk";
import { getDepositPayloadThunk } from "./thunks/getDepositPayloadThunk";
import { IDataService } from "../data/interfaces/data.service.interface";
import { DEFAULT_MAINNET_FEE_CONFIG, DEFAULT_OTHER_FEE_CONFIG, IRelayerFeeConfig, setRelayerFeeConfig } from "./slices/relayersSlice";
import { ProtocolConfigState } from "./slices/protocolConfigSlice";

const ETH_SEPOLIA_CHAIN_ID = 11155111n;

export interface StoreFactoryParams {
  secretManagerFactory: () => Promise<ISecretManager>;
  dataService: IDataService;
  relayerClient: IRelayerClient;
  paymasterConfig: IChainsPaymastersConfig;
  storageToSyncTo?: Storage;
  protocolConfig: TCProtocolConfig;
  relayerConfig?: IRelayerFeeConfig;
  proverFactory: () => Promise<ITornadoProver>;
  initialState?: () => Promise<Record<
    string,
    PublicRootState
  >>;
}

interface GetChainStoreParams {
  chainId: ChainId;
  protocolConfig: ProtocolConfigState;
  relayerConfig: IRelayerFeeConfig;
}

const getStoreKey = ({
  chainId,
  protocolConfig: { instanceRegistry: { address } },
}: GetChainStoreParams): StoreKey => `${chainId.toString()}-${address}`;

const getStoreStorageKey = (
  params: GetChainStoreParams,
): StoreStorageKey => `tornado-cash-state-${getStoreKey(params)}`;

const initializeSelectors = <const T extends Store>(store: T) => ({
  ...store,
  selectors: {
    specificAssetsBalanceSelector: ((assets: Address[] | Address | undefined) =>
      Promise.resolve(specificAssetsBalanceSelector(store.getState(), assets as Address[]))) as unknown as SpecificAssetBalanceFn<true>,
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
        protocolConfig,
        relayerConfig
      } = getChainStoreParams;
      const computedChainKey = getStoreKey(getChainStoreParams);
      let storeWithSelectors = chainStoreMap.get(computedChainKey);

      if (!storeWithSelectors) {
        const storageKey = getStoreStorageKey(getChainStoreParams);
        const rawStoredState = storageToSyncTo ? await storageToSyncTo.get(storageKey) : undefined;
        const storedState: PublicRootState | undefined = rawStoredState ? JSON.parse(rawStoredState) : undefined;
        const snapshotInitialState = storedState || !resolveInitialState
          ? undefined
          : (await resolveInitialState())[storageKey];
        let initialState: PublicRootState | undefined = storedState || snapshotInitialState;

        if (!initialState && getChainStoreParams.chainId === ETH_SEPOLIA_CHAIN_ID) {
          initialState = await import('./initial-states/state.11155111.minimal.json').then((a) => a["tornado-cash-state-11155111-447664927873626138772898946646079239273904189887"] as never);
        }

        const store = storeFactory({
          protocolConfig,
          initialState,
        });

        store.dispatch(setRelayerFeeConfig(relayerConfig));

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
  paymasterConfig,
  proverFactory,
  storageToSyncTo,
  initialState,
  protocolConfig,
  relayerConfig,
}: StoreFactoryParams): Promise<IStateManager> => {
  const secretManager = await secretManagerFactory();
  const { getChainStore, getAllStores } = storeByChainAndEntrypoint({
    storageToSyncTo,
    initialState,
  });

  const getChainInfo = async () => {
    const chainId = await dataService.getChainId();
    const actualRelayerConfig = relayerConfig ?? chainId === 1n ? DEFAULT_MAINNET_FEE_CONFIG : DEFAULT_OTHER_FEE_CONFIG;

    return {
      chainId,
      relayerConfig: actualRelayerConfig,
      protocolConfig: {
        ...protocolConfig,
        chainId,
      },
    };
  }

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
    getDepositPayload: async ({ asset, amount, strategy }: IDepositOperationParams) => {
      const store = await getChainStore(await getChainInfo());

      return unwrapResult(
        await store.dispatch(
          getDepositPayloadThunk({ secretManager, asset, amount, strategy }),
        ),
      );
    },
    getWithdrawalPayloads: async (params: IWithdrawapOperationParams): Promise<IWithdrawalPayload[]> => {
      const store = await getChainStore(await getChainInfo());
      const { asset, amount, recipient } = params;

      if (params.mode === 'paymaster') {
        return unwrapResult(
          await store.dispatch(
            paymasterWithdrawThunk({
              proverFactory,
              recipient,
              dataService,
              assetAddress: asset,
              amount,
              paymasterSettings: {
                ...paymasterConfig,
                delegation: params.delegation,
              },
              secretManager,
            }),
          ),
        );
      }

      return unwrapResult(
        await store.dispatch(
          withdrawThunk({
            proverFactory,
            recipient,
            relayerClient,
            dataService,
            assetAddress: asset,
            amount,
            preferredRelayersEns: params.preferredRelayersEns ? new Set(params.preferredRelayersEns) : undefined
          }),
        ),
      );

    },
    dumpState: () => getAllStores(),
  };
};
