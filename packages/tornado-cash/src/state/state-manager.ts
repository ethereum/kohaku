import type { EthereumProvider } from '@kohaku-eth/provider';
/* eslint-disable max-lines */
import { ChainId, Storage } from "@kohaku-eth/plugins";
import { Store, unwrapResult } from "@reduxjs/toolkit";

import { Address } from "../interfaces/types.interface";
import {
  IDepositOperationParams,
  IGetNotesParams,
  IStateManager,
  IWithdrawapOperationParams,
  StoreKey,
  StoreStorageKey,
  IWithdrawalPayload,
  TCProtocolConfig,
  IChainsPaymastersConfig,
} from "../plugin/interfaces/protocol-params.interface";
import { IRelayerClient } from "../relayer/interfaces/relayer-client.interface";
import { ITornadoProver } from "../utils/tornado-prover.js";
import { ISecretManager } from "../account/keys";
import {
  specificAssetsBalanceSelector,
  SpecificAssetBalanceFn,
} from "./selectors/balance.selector";
import { allNotesSelector } from "./selectors/notes.selector";
import { PublicRootState, storeFactory } from "./store";
import { syncThunk } from "./thunks/syncThunk";
import { syncRelayersThunk } from "./thunks/syncRelayersThunk";
import { withdrawThunk } from "./thunks/withdrawThunk";
import { paymasterWithdrawThunk } from "./thunks/paymasterWithdrawThunk";
import { getDepositPayloadThunk } from "./thunks/getDepositPayloadThunk";
import { importLegacyNotesThunk } from "./thunks/importLegacyNotesThunk";
import { assertSignatureGapLimit } from "./thunks/discoverUserEventsThunk";
import { IDataService } from "../data/interfaces/data.service.interface";
import { ISyncService } from "../data/interfaces/sync.service.interface";
import { DEFAULT_MAINNET_FEE_CONFIG, DEFAULT_OTHER_FEE_CONFIG, IRelayerFeeConfig, setRelayerFeeConfig } from "./slices/relayersSlice";
import { ProtocolConfigState } from "./slices/protocolConfigSlice";
import { removePools } from "./slices/poolsSlice";
import { assetSelector, depositsSelector, legacyUserSecretsSelector, poolsSelector, relayersSelector, withdrawalsSelector } from "./selectors/slices.selectors";
import { catalogInstanceFor, instanceCatalog, ITornadoInstance } from "../instances";
import { createLoadCache, createSerialQueue, createSyncQueue } from "./utils/async.utils";
import { validateSnapshot } from "./utils/snapshot.utils";
import { TornadoPoolSyncError } from "./pool-sync-error";

const ETH_SEPOLIA_CHAIN_ID = 11155111n;

export interface StoreFactoryParams {
  /** Host RPC for independent fee-market checks; does not extend IDataService. */
  provider?: EthereumProvider;
  secretManagerFactory: () => Promise<ISecretManager>;
  dataService: IDataService;
  syncService: ISyncService;
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
    getAllNotes: () => allNotesSelector(store.getState()),
  },
  getPublicState: () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { userSecrets, legacySecrets, signatureSecrets, signatureNonces, ...publicState } = store.getState();

    return publicState;
  },
  getPrivateState: () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { userSecrets, signatureSecrets, ...publicState } = store.getState();

    return publicState;
  }
});

const storeByChainAndEntrypoint = ({
  storageToSyncTo,
  initialState: initialStateCallback,
  instances,
}: Pick<StoreFactoryParams, 'storageToSyncTo' | 'initialState'> & { instances?: readonly ITornadoInstance[] }) => {

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

  type ChainStore = ReturnType<typeof initializeSelectors<ReturnType<typeof storeFactory>>>;

  const chainStoreMap = new Map<StoreKey, ChainStore>();
  // Calls that race a chain's first load share it: two stores for one chain
  // would each take writes the other never sees, and both would be persisted.
  const loadStore = createLoadCache<ChainStore>();

  const loadChainStore = async (getChainStoreParams: GetChainStoreParams): Promise<ChainStore> => {
    const {
      protocolConfig,
      relayerConfig
    } = getChainStoreParams;
    const storageKey = getStoreStorageKey(getChainStoreParams);
    const readSnapshot = (value: unknown) => {
      try {
        return validateSnapshot(typeof value === 'string' ? JSON.parse(value) : value);
      } catch {
        throw new Error(`Invalid Tornado Cash snapshot for ${storageKey}. Restore a valid backup or rebuild the sync cache while preserving imported legacy notes.`);
      }
    };
    const rawStoredState = storageToSyncTo ? await storageToSyncTo.get(storageKey) : undefined;
    const storedState = rawStoredState ? readSnapshot(rawStoredState) : undefined;
    const snapshotInitialState = storedState || !resolveInitialState
      ? undefined
      : (await resolveInitialState())[storageKey];
    let initialState = storedState ?? (snapshotInitialState === undefined ? undefined : readSnapshot(snapshotInitialState));

    if (!initialState && getChainStoreParams.chainId === ETH_SEPOLIA_CHAIN_ID) {
      initialState = readSnapshot(await import('./initial-states/state.11155111.minimal.json').then((a) => a["tornado-cash-state-11155111-447664927873626138772898946646079239273904189887"]));
    }

    const store = storeFactory({
      protocolConfig,
      initialState,
    });

    store.dispatch(setRelayerFeeConfig(relayerConfig));

    try {
      for (const select of [depositsSelector, withdrawalsSelector, poolsSelector, assetSelector, relayersSelector, legacyUserSecretsSelector]) select(store.getState());
    } catch {
      throw new Error(`Invalid Tornado Cash snapshot for ${storageKey}. Restore a valid backup or rebuild the sync cache while preserving imported legacy notes.`);
    }

    // Pools saved by an older version (or a poisoned RPC) may not be
    // catalog instances; drop them so nothing downstream can use them.
    const catalog = instanceCatalog(getChainStoreParams.chainId, instances);

    if (catalog) {
      const outsideCatalog = [...poolsSelector(store.getState()).values()]
        .filter((pool) => !catalogInstanceFor(catalog, pool))
        .map((pool) => pool.address);

      if (outsideCatalog.length > 0) store.dispatch(removePools(outsideCatalog));
    }

    const storeWithSelectors = initializeSelectors(store);

    chainStoreMap.set(getStoreKey(getChainStoreParams), storeWithSelectors);

    return storeWithSelectors;
  };

  return {
    getChainStore: (getChainStoreParams: GetChainStoreParams): Promise<ChainStore> =>
      loadStore(getStoreKey(getChainStoreParams), () => loadChainStore(getChainStoreParams)),
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
  provider,
  syncService,
  relayerClient,
  paymasterConfig,
  proverFactory,
  storageToSyncTo,
  initialState,
  protocolConfig: { instances, signatureGapLimit, ...protocolConfig },
  relayerConfig,
}: StoreFactoryParams): Promise<IStateManager> => {
  if (signatureGapLimit !== undefined) assertSignatureGapLimit(signatureGapLimit);

  const secretManager = await secretManagerFactory();
  const { getChainStore, getAllStores } = storeByChainAndEntrypoint({
    storageToSyncTo,
    initialState,
    instances,
  });

  const getChainInfo = async () => {
    const chainId = await dataService.getChainId();
    const actualRelayerConfig = relayerConfig ?? (chainId === 1n ? DEFAULT_MAINNET_FEE_CONFIG : DEFAULT_OTHER_FEE_CONFIG);

    return {
      chainId,
      relayerConfig: actualRelayerConfig,
      protocolConfig: {
        ...protocolConfig,
        chainId,
      },
    };
  }

  const persistStateIfAvailable = async (
    chainInfo: GetChainStoreParams,
    store: Awaited<ReturnType<typeof getChainStore>>,
  ): Promise<void> => {
    if (storageToSyncTo) {
      await storageToSyncTo.set(
        getStoreStorageKey(chainInfo),
        JSON.stringify(store.getPrivateState()),
      );
    }
  };

  // Writes to a chain's state run one at a time, each persisting before the next
  // starts: overlapping writes would each start from a stale cursor, and their
  // saves could land out of order, the older snapshot last.
  const writeQueues = new Map<StoreKey, ReturnType<typeof createSerialQueue>>();
  const enqueueWrite = <T>(
    chainInfo: GetChainStoreParams,
    run: (store: Awaited<ReturnType<typeof getChainStore>>) => Promise<T>,
  ): Promise<T> => {
    const storeKey = getStoreKey(chainInfo);
    const enqueue = writeQueues.get(storeKey) ?? createSerialQueue();

    writeQueues.set(storeKey, enqueue);

    return enqueue(async () => run(await getChainStore(chainInfo)));
  };

  // Syncs called while one runs share a single follow-up instead of each queueing one.
  const syncQueues = new Map<StoreKey, ReturnType<typeof createSyncQueue>>();

  return {
    sync: async (): Promise<void> => {
      const chainInfo = await getChainInfo();
      const storeKey = getStoreKey(chainInfo);
      const enqueue = syncQueues.get(storeKey) ?? createSyncQueue();

      syncQueues.set(storeKey, enqueue);

      return enqueue(() => enqueueWrite(chainInfo, async (store) => {
        const { failures, totalPools } = unwrapResult(
          await store.dispatch(
            syncThunk({
              dataService,
              syncService,
              relayerClient,
              secretManager,
              signatureGapLimit,
              instances,
              ...store.selectors,
            }),
          ),
        );

        // What the healthy pools synced is kept, but callers must not read
        // balances or notes as complete while some pools are missing.
        await persistStateIfAvailable(chainInfo, store);

        if (failures.length > 0) throw new TornadoPoolSyncError(failures, totalPools);
      }));
    },
    getBalances: async (assets) => {
      const { selectors: { specificAssetsBalanceSelector } } =
        await getChainStore(await getChainInfo());

      return specificAssetsBalanceSelector(assets);
    },
    getNotes: async ({
      includeSpent = false,
      assets = [],
    }: IGetNotesParams) => {
      const store = await getChainStore(await getChainInfo());
      let notes = store.selectors.getAllNotes();

      if (!includeSpent) {
        notes = notes.filter((note) => note.balance > 0n);
      }

      if (assets.length > 0) {
        const assetSet = new Set(assets);

        notes = notes.filter((note) => assetSet.has(note.assetAddress));
      }

      return notes;
    },
    getDepositPayload: async ({ asset, amount, strategy }: IDepositOperationParams) => {
      const chainInfo = await getChainInfo();

      // Queued and persisted so the nonces it reserves survive a restart and
      // a concurrent preparation starts after them.
      return enqueueWrite(chainInfo, async (store) => {
        const payload = unwrapResult(
          await store.dispatch(
            getDepositPayloadThunk({ secretManager, asset, amount, strategy, instances }),
          ),
        );

        await persistStateIfAvailable(chainInfo, store);

        return payload;
      });
    },
    getWithdrawalPayloads: async (params: IWithdrawapOperationParams): Promise<IWithdrawalPayload[]> => {
      const chainInfo = await getChainInfo();
      const store = await getChainStore(chainInfo);
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
              tailCalls: params.tailCalls,
              tailCallsGasEstimate: params.tailCallsGasEstimate,
              gasEstimationPolicy: params.gasEstimationPolicy,
              executionGasRetry: params.executionGasRetry,
              maxGasLimits: params.maxGasLimits,
              bundlerPost: params.bundlerPost,
              provider,
            }),
          ),
        );
      }

      // ENS/TORN-staked relayers are only needed for traditional withdrawals.
      // Balances, shields and paymaster withdrawals must not depend on them.
      await enqueueWrite(chainInfo, async () => {
        unwrapResult(await store.dispatch(syncRelayersThunk({ dataService, syncService })));
        await persistStateIfAvailable(chainInfo, store);
      });

      return unwrapResult(
        await store.dispatch(
          withdrawThunk({
            proverFactory,
            recipient,
            relayerClient,
            dataService,
            assetAddress: asset,
            amount,
            preferredRelayersEns: params.preferredRelayersEns ? new Set(params.preferredRelayersEns) : undefined,
            paymasterConfig,
            instances,
          }),
        ),
      );

    },
    importNotes: async ({ notes }) => {
      const chainInfo = await getChainInfo();

      return enqueueWrite(chainInfo, async (store) => {
        const result = unwrapResult(
          await store.dispatch(importLegacyNotesThunk({ notes })),
        );

        await persistStateIfAvailable(chainInfo, store);

        return result;
      });
    },
    dumpState: () => getAllStores(),
  };
};
