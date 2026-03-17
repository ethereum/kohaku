/* eslint-disable max-lines */
import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { ChainId, Storage } from "@kohaku-eth/plugins";
import { Store, unwrapResult } from "@reduxjs/toolkit";

import { relayDataAbi } from "../data/abis/entrypoint.abi";
import { Address } from "../interfaces/types.interface";
import {
  IDepositOperationParams,
  IEntrypoint,
  IGetNotesParams,
  INote,
  IRagequitAssetsOperationParams,
  IRagequitLabelsOperationParams,
  IStateManager,
  IWithdrawapOperationParams,
  StateRagequitPayload,
  StateWithdrawalPayload,
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
  IBalanceType,
  SpecificAssetBalanceFn,
} from "./selectors/balance.selector";
import {
  createGetNextDepositPayloadSelector,
  createGetNextDepositSecretsSelector,
  createMyDepositsCountSelector,
  createMyDepositsSelector,
  createMyEntrypointDepositsSelector,
} from "./selectors/deposits.selector";
import {
  createAllNotesSelector,
  createExistingNoteSecretsDeriver,
  createGetNoteSelector,
  createNextNoteDeriver,
  createUnapprovedNotesByAssetSelector,
  createUnapprovedNotesSelector,
} from "./selectors/notes.selector";
import { createMyPoolsSelector, poolFromAssetSelector } from "./selectors/pools.selector";
import { createMyRagequitsSelector } from "./selectors/ragequits.selector";
import { createMyWithdrawalsSelector } from "./selectors/withdrawals.selector";
import { RootState, storeFactory } from "./store";
import { quoteThunk } from "./thunks/quoteThunk";
import { ragequitThunk } from "./thunks/ragequitThunk";
import { SyncAspThunkParams } from "./thunks/syncAspThunk";
import { syncThunk } from "./thunks/syncThunk";
import { withdrawThunk } from "./thunks/withdrawThunk";
import { deserialize } from "./utils/serialize.utils";

export interface StoreFactoryParams
  extends BaseSelectorParams, SyncAspThunkParams {
  relayerClient: IRelayerClient;
  relayersList: Map<string, string>;
  storageToSyncTo?: Storage;
  entrypoint: IEntrypoint;
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
  const depositsCountSelector =
    createMyDepositsCountSelector(myDepositsSelector);
  const myRagequitsSelector = createMyRagequitsSelector(myDepositsSelector);
  const myEntrypointDepositsSelector =
    createMyEntrypointDepositsSelector(myDepositsSelector);
  const myDepositsWithAssetSelector =
    createMyDepositsWithAssetSelector(myDepositsSelector);
  const myWithdrawalsSelector = createMyWithdrawalsSelector({
    myDepositsSelector,
    ...params,
  });

  const myPoolsSelector = createMyPoolsSelector(myEntrypointDepositsSelector);

  const myDepositsBalanceSelector = createMyDepositsBalanceSelector({
    myDepositsWithAssetSelector,
    myRagequitsSelector,
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

  // Deposit payload selectors
  const getNextDepositSecretsSelector = createGetNextDepositSecretsSelector({
    depositsCountSelector,
    secretManager: params.secretManager,
  });
  const getNextDepositPayloadSelector = createGetNextDepositPayloadSelector({
    getNextDepositSecretsSelector,
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
      depositsCount: () => depositsCountSelector(store.getState()),

      myAssetsBalanceSelector: () => myAssetsBalanceSelector(store.getState()),
      specificAssetsBalanceSelector: ((addresses: Address[], balanceType: IBalanceType = 'approved') => specificAssetsBalanceSelector(store.getState(), addresses, balanceType)) as SpecificAssetBalanceFn,
      getExistingNoteSecrets,
      getNextDepositPayload: (asset: Address, amount: bigint) =>
        getNextDepositPayloadSelector(store.getState(), asset, amount),
      getNextNote,
      getNote: (assetAddress: Address, minAmount: bigint) => getNoteSelector(store.getState(), assetAddress, minAmount),
      getAllNotes: () => allNotesSelector(store.getState()),

      myPoolsSelector: () => myPoolsSelector(store.getState()),
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
  entrypoint: IEntrypoint;
}

const getStoreKey = ({
  chainId,
  entrypoint: { address },
}: GetChainStoreParams): `${string}-${string}` =>
  `${chainId.toString()}-${address}`;
const getStoreStorageKey = (
  params: GetChainStoreParams,
): `privacy-pool-state-${ReturnType<typeof getStoreKey>}` =>
  `privacy-pool-state-${getStoreKey(params)}`;

const storeByChainAndEntrypoint = ({
  storageToSyncTo,
  initialState,
  ...params
}: Omit<StoreFactoryParams, "dataService">) => {
  const initialMapState = Object.entries(initialState || {}).map(
    ([key, state]) =>
      [
        key,
        initializeSelectors({
          ...params,
          store: storeFactory({
            entrypointInfo: deserialize(state!.entrypointInfo),
            initialState: state,
          }),
        }),
      ] as const,
  );

  const chainStoreMap = new Map<
    string,
    ReturnType<typeof initializeSelectors<ReturnType<typeof storeFactory>>>
  >(initialMapState);

  return {
    getChainStore: (getChainStoreParams: GetChainStoreParams) => {
      const {
        chainId,
        entrypoint: { address, deploymentBlock },
      } = getChainStoreParams;
      const computedChainKey = getStoreKey(getChainStoreParams);
      let storeWithSelectors = chainStoreMap.get(computedChainKey);

      const storedState = storageToSyncTo?.get(
        getStoreStorageKey(getChainStoreParams),
      );

      if (!storeWithSelectors) {
        const initialState: RootState | undefined = storedState
          ? JSON.parse(storedState)
          : undefined;
        const store = storeFactory({
          entrypointInfo: {
            chainId,
            entrypointAddress: address,
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
          [chainKey]: state.getState(),
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
    entrypoint: params.entrypoint
  });

  return {
    sync: async (): Promise<void> => {
      const chainInfo = await getChainInfo();

      const store = getChainStore(chainInfo);

      await store.dispatch(
        syncThunk({
          ...params,
          ...store.selectors,
        }),
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
      balanceType,
    ) => {
      const {
        selectors: {
          specificAssetsBalanceSelector,
        },
      } = getChainStore(await getChainInfo());

      return specificAssetsBalanceSelector(assets, balanceType);
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
          relayers: params.relayersList,
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
    getRagequitPayloads: async ({
      assets = [],
    }: IRagequitAssetsOperationParams): Promise<StateRagequitPayload[]> => {
      const chainInfo = await getChainInfo();
      const store = getChainStore(chainInfo);

      // 1. Get all unapproved notes for the specified assets
      const unapprovedNotes = assets.length > 0
        ? store.selectors.getUnapprovedNotesByAsset(assets)
        : store.selectors.getUnapprovedNotes();

      if (unapprovedNotes.length === 0) {
        return [];
      }

      // 2. Generate proofs for each note
      const ragequitResults = await Promise.all(
        unapprovedNotes.map(async (note) => {
          const resultAction = await store.dispatch(
            ragequitThunk({
              note,
              getExistingNoteSecrets: store.selectors.getExistingNoteSecrets,
              proverFactory: params.proverFactory,
            })
          );

          if (resultAction.meta.requestStatus === "rejected") {
            console.warn(`Failed to generate ragequit proof for note ${note.label}`);

            return null;
          }

          return unwrapResult(resultAction);
        })
      );

      // 3. Filter out failed proofs and return payloads
      return ragequitResults
        .filter((result): result is NonNullable<typeof result> => result !== null)
        .map(({ note, poolAddress, proofResult }) => ({
          note,
          poolAddress,
          proofResult,
        }));
    },
    getRagequitByLabelPayloads: async ({
      labels = [],
    }: IRagequitLabelsOperationParams): Promise<StateRagequitPayload[]> => {
      const chainInfo = await getChainInfo();
      const store = getChainStore(chainInfo);

      // 1. Get all unapproved notes for the specified assets
      const allNotes = store.selectors.getAllNotes();

      if (allNotes.length === 0) {
        return [];
      }

      // 2. Generate proofs for each note
      const ragequitResults = await Promise.all(
        allNotes
          .filter(note => labels.includes(note.label))
          .map(async (note) => {
            const resultAction = await store.dispatch(
              ragequitThunk({
                note,
                getExistingNoteSecrets: store.selectors.getExistingNoteSecrets,
                proverFactory: params.proverFactory,
              })
            );

            if (resultAction.meta.requestStatus === "rejected") {
              console.warn(`Failed to generate ragequit proof for note ${note.label}`);

              return null;
            }

            return unwrapResult(resultAction);
          })
      );

      // 3. Filter out failed proofs and return payloads
      return ragequitResults
        .filter((result): result is NonNullable<typeof result> => result !== null)
        .map(({ note, poolAddress, proofResult }) => ({
          note,
          poolAddress,
          proofResult,
        }));
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
