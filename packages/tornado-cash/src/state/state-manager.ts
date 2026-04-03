/* eslint-disable max-lines */
import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { ChainId, Storage } from "@kohaku-eth/plugins";
import { Store, unwrapResult } from "@reduxjs/toolkit";

import { relayDataAbi } from "../data/abis/instance-registry.abi";
import { Address } from "../interfaces/types.interface";
import {
  IDepositOperationParams,
  IInstanceRegistry,
  IGetNotesParams,
  INote,
  IStateManager,
  IWithdrawapOperationParams,
  StateWithdrawalPayload,
  StoreKey,
  StoreStorageKey,
} from "../plugin/interfaces/protocol-params.interface";
import { IRelayerClient } from "../relayer/interfaces/relayer-client.interface";
import { addressToHex } from "../utils";
import { decodeRelayData } from "../utils/encoding.utils";
import { calculateContext } from "../utils/proof.util";
import { BaseSelectorParams } from "./interfaces/selectors.interface";
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
import {
  createAllNotesSelector,
  createExistingNoteSecretsDeriver,
  createGetNoteSelector,
  createNextNoteDeriver,
  createUnapprovedNotesByAssetSelector,
  createUnapprovedNotesSelector,
} from "./selectors/notes.selector";
import { poolFromAssetSelector } from "./selectors/pools.selector";
import { createMyWithdrawalsSelector } from "./selectors/withdrawals.selector";
import { RootState, storeFactory } from "./store";
import { quoteThunk } from "./thunks/quoteThunk";
import { syncThunk } from "./thunks/syncThunk";
import { withdrawThunk } from "./thunks/withdrawThunk";

export interface StoreFactoryParams
  extends BaseSelectorParams {
  relayerClient: IRelayerClient;
  storageToSyncTo?: Storage;
  instanceRegistry: IInstanceRegistry;
  proverFactory: () => ReturnType<typeof Prover>;
  initialState?: Record<
    string,
    Parameters<typeof storeFactory>[0]["initialState"]
  >;
}

const initializeSelectors = <const T extends Store>({
  store,
  ...params
}: Omit<StoreFactoryParams, "dataService"> & { store: T; }) => {
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

  // Note selectors for withdrawals
  const getNoteSelector = createGetNoteSelector({
    myDepositsBalanceSelector,
    myWithdrawalsSelector,
  });
  const allNotesSelector = createAllNotesSelector({
    myDepositsBalanceSelector,
    myWithdrawalsSelector,
  });
  const getNextNote = createNextNoteDeriver({
    secretManager: params.secretManager,
  });
  const getExistingNoteSecrets = createExistingNoteSecretsDeriver({
    secretManager: params.secretManager,
  });

  const getNextPoolDepositsPayloadSelector = createGetNextDepositsPayloadSelector({
    myDepositsSelector,
    secretsManager: params.secretManager,
  });

  const allAssetsBalanceSelector = createAllAssetsBalanceSelector(myAssetsBalanceSelector);
  const specificAssetsBalanceSelector = createSpecificAssetBalanceSelector(allAssetsBalanceSelector);

  // Ragequit selectors for unapproved notes
  const unapprovedNotesSelector = createUnapprovedNotesSelector({
    myDepositsBalanceSelector,
    myWithdrawalsSelector,
  });
  const unapprovedNotesByAssetSelector = createUnapprovedNotesByAssetSelector({
    unapprovedNotesSelector,
  });

  return {
    ...store,
    selectors: {
      myAssetsBalanceSelector: () => myAssetsBalanceSelector(store.getState()),
      specificAssetsBalanceSelector: ((addresses: Address[]) => specificAssetsBalanceSelector(store.getState(), addresses)) as SpecificAssetBalanceFn,
      getExistingNoteSecrets,
      getNextDepositPayload: (asset: Address, amount: bigint) =>
        getNextPoolDepositsPayloadSelector(store.getState(), asset, amount),
      getNextNote,
      getNote: (assetAddress: Address, minAmount: bigint) => getNoteSelector(store.getState(), assetAddress, minAmount),
      getAllNotes: () => allNotesSelector(store.getState()),

      poolFromAssetSelector: (assetAddress: Address) => poolFromAssetSelector(store.getState(), assetAddress),

      // Ragequit selectors
      getUnapprovedNotes: () => unapprovedNotesSelector(store.getState()),
      getUnapprovedNotesByAsset: (assets: Address[]) =>
        unapprovedNotesByAssetSelector(store.getState(), assets),
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
): StoreStorageKey => `privacy-pool-state-${getStoreKey(params)}`;

const storeByChainAndEntrypoint = ({
  storageToSyncTo,
  initialState: initialStateByChainAndEntrypoint = {},
  ...params
}: Omit<StoreFactoryParams, "dataService">) => {

  const chainStoreMap = new Map<
    StoreKey,
    ReturnType<typeof initializeSelectors<ReturnType<typeof storeFactory>>>
  >();

  return {
    getChainStore: (getChainStoreParams: GetChainStoreParams) => {
      const {
        chainId,
        instanceRegistry: { address, deploymentBlock },
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
          },
          initialState,
        });

        storeWithSelectors = initializeSelectors({ ...params, store });
        chainStoreMap.set(computedChainKey, storeWithSelectors);
      }

      return storeWithSelectors;
    },
    getAllStores: (): ReturnType<IStateManager['dumpState']> => {
      return Array.from(chainStoreMap).reduce(
        (completeState, [chainKey, state]) => ({
          ...completeState,
          [`privacy-pool-state-${chainKey}`]: state.getState(),
        }),
        {} as ReturnType<IStateManager['dumpState']>,
      );
    },
  };
};

export const storeStateManager = (
  params: StoreFactoryParams,
): IStateManager => {
  const { getChainStore, getAllStores } = storeByChainAndEntrypoint(params);
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
    }: IWithdrawapOperationParams): Promise<Array<StateWithdrawalPayload>> => {
      const chainInfo = await getChainInfo();
      const store = getChainStore(chainInfo);

      // Get best quote from relayers
      const quoteResultAction = await store.dispatch(
        quoteThunk({
          relayerClient: params.relayerClient,
          asset,
          amount: amount ?? 0n,
          recipient,
        }),
      );

      if (quoteResultAction.meta.requestStatus === "rejected") {
        throw new Error("Failed to get quote from relayers");
      }

      const { quote, relayerId } = unwrapResult(quoteResultAction);

      const poolInfo = store.selectors.poolFromAssetSelector(asset);

      if (!poolInfo)
        throw new Error(`No pool found for asset ${asset}`);

      const withdrawal = {
        processooor: addressToHex(params.entrypoint.address) as `0x${string}`,
        data: quote.feeCommitment.withdrawalData as `0x${string}`,
      };
      const context = BigInt(calculateContext(withdrawal, poolInfo.scope));

      // Dispatch the withdraw thunk which handles note selection and proof generation
      const withdrawResultAction = await store.dispatch(
        withdrawThunk({
          getNote: store.selectors.getNote,
          getNextNote: store.selectors.getNextNote,
          getExistingNoteSecrets: store.selectors.getExistingNoteSecrets,
          proverFactory: params.proverFactory,
          asset,
          amount: amount ?? 0n,
          recipient,
          context,
        })
      );

      const withdrawProofResult = unwrapResult(withdrawResultAction);

      return [{
        withdrawalInfo: {
          context,
          scope: poolInfo.scope,
          // raw RelayData:= { address recipient; address feeRecipient; uint256 relayFeeBPS;  }
          relayDataAbi: JSON.stringify(relayDataAbi),
          relayDataObject: decodeRelayData(withdrawal.data),
          withdrawalObject: withdrawal,
        },
        proofResult: withdrawProofResult,
        quoteData: { quote, relayerId },
        chainId: chainInfo.chainId,
      }];
    },
    getNotes: async ({
      includeSpent = false,
      assets = [],
    }: IGetNotesParams): Promise<INote[]> => {
      const store = getChainStore(await getChainInfo());
      let notes = store.selectors.getAllNotes();

      // Filter out spent notes unless includeSpent
      if (!includeSpent) {
        notes = notes.filter(note => note.balance > 0n);
      }

      // Filter by assets if specified
      if (assets.length > 0) {
        const assetSet = new Set(assets.map(a => a.toString()));

        notes = notes.filter(note => assetSet.has(note.assetAddress.toString()));
      }

      return notes;
    },
    dumpState: () => getAllStores(),
  };
};
