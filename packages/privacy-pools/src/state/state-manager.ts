/* eslint-disable max-lines */
import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { ChainId, Storage } from "@kohaku-eth/plugins";
import { Store, unwrapResult } from "@reduxjs/toolkit";

import { ISecretManager } from "../account/keys";
import { IDataService } from "../data/interfaces/data.service.interface";
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
  StoreKey,
  StoreStorageKey,
} from "../plugin/interfaces/protocol-params.interface";
import { IRelayerClient } from "../relayer/interfaces/relayer-client.interface";
import { addressToHex } from "../utils";
import { decodeRelayData } from "../utils/encoding.utils";
import { calculateContext } from "../utils/proof.util";
import {
  allNotesSelector,
  createNextNoteDeriver,
  unapprovedNotesByAssetSelector,
  unapprovedNotesSelector,
} from "./selectors/notes.selector";
import {
  myPoolsSelector,
  poolFromAssetSelector,
} from "./selectors/pools.selector";
import {
  entrypointInfoSelector,
  userSecretsSelector,
} from "./selectors/slices.selectors";
import { buildDepositPayload, myDepositsCountSelector } from "./selectors/deposits.selector";
import {
  IBalanceType,
  SpecificAssetBalanceFn,
  specificAssetsBalanceSelector,
} from "./selectors/balance.selector";
import { getNoteSelector } from "./selectors/notes.selector";
import { PublicRootState, RootState, storeFactory } from "./store";
import { quoteThunk } from "./thunks/quoteThunk";
import { ragequitThunk } from "./thunks/ragequitThunk";
import { SyncAspThunkParams } from "./thunks/syncAspThunk";
import { syncThunk } from "./thunks/syncThunk";
import { withdrawThunk } from "./thunks/withdrawThunk";

export interface StoreFactoryParams extends SyncAspThunkParams {
  secretManager: ISecretManager;
  dataService: IDataService;
  relayerClient: IRelayerClient;
  relayersList: Map<string, string>;
  storageToSyncTo?: Storage;
  entrypoint: IEntrypoint;
  proverFactory: () => ReturnType<typeof Prover>;
  initialState?: () => Promise<Record<string, PublicRootState>>;
}

const initializeSelectors = <const T extends Store>({
  store,
  secretManager,
}: { store: T; secretManager: ISecretManager }) => {
  const getNextNote = createNextNoteDeriver({ secretManager });

  return {
    ...store,
    selectors: {
      specificAssetsBalanceSelector: ((addresses: Address[], balanceType: IBalanceType = 'approved') =>
        specificAssetsBalanceSelector(store.getState(), addresses, balanceType)) as SpecificAssetBalanceFn,
      getNote: (assetAddress: Address, minAmount: bigint) =>
        getNoteSelector(store.getState(), assetAddress, minAmount),
      getNextNote,
      getAllNotes: () => allNotesSelector(store.getState()),
      myPoolsSelector: () => myPoolsSelector(store.getState()),
      poolFromAssetSelector: (assetAddress: Address) => poolFromAssetSelector(store.getState(), assetAddress),
      getUnapprovedNotes: () => unapprovedNotesSelector(store.getState()),
      getUnapprovedNotesByAsset: (assets: Address[]) =>
        unapprovedNotesByAssetSelector(store.getState(), assets),
    },
    getPublicState: (): PublicRootState => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { userSecrets, ...publicState } = store.getState() as RootState;

      return publicState;
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
}: GetChainStoreParams): StoreKey => `${chainId.toString()}-${address}`;

const getStoreStorageKey = (
  params: GetChainStoreParams,
): StoreStorageKey => `privacy-pool-state-${getStoreKey(params)}`;

const storeByChainAndEntrypoint = ({
  storageToSyncTo,
  initialState: initialStateCallback,
  secretManager,
}: Pick<StoreFactoryParams, 'storageToSyncTo' | 'initialState' | 'secretManager'>) => {
  let cachedInitialState: Record<string, PublicRootState> | undefined;

  const resolveInitialState = initialStateCallback
    ? async () => {
        cachedInitialState ??= await initialStateCallback();

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
        entrypoint: { address, deploymentBlock },
      } = getChainStoreParams;
      const computedChainKey = getStoreKey(getChainStoreParams);
      let storeWithSelectors = chainStoreMap.get(computedChainKey);

      if (!storeWithSelectors) {
        const storageKey = getStoreStorageKey(getChainStoreParams);
        const rawStoredState = storageToSyncTo ? await storageToSyncTo.get(storageKey) : null;
        const storedState: PublicRootState | undefined = rawStoredState ? JSON.parse(rawStoredState) : undefined;
        const snapshotInitialState = storedState || !resolveInitialState
          ? undefined
          : (await resolveInitialState())[storageKey];
        const initialState: PublicRootState | undefined = storedState ?? snapshotInitialState;
        const store = storeFactory({
          entrypointInfo: { chainId, entrypointAddress: address, deploymentBlock },
          initialState: initialState as RootState | undefined,
        });

        storeWithSelectors = initializeSelectors({ store, secretManager });
        chainStoreMap.set(computedChainKey, storeWithSelectors);
      }

      return storeWithSelectors;
    },
    getAllStores: (): ReturnType<IStateManager['dumpState']> => {
      return Array.from(chainStoreMap).reduce(
        (completeState, [chainKey, state]) => ({
          ...completeState,
          [`privacy-pool-state-${chainKey}`]: state.getPublicState(),
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
  const { storageToSyncTo, secretManager } = params;

  const getChainInfo = async () => ({
    chainId: await params.dataService.getChainId(),
    entrypoint: params.entrypoint,
  });

  return {
    sync: async (): Promise<void> => {
      const chainInfo = await getChainInfo();
      const store = await getChainStore(chainInfo);

      unwrapResult(
        await store.dispatch(
          syncThunk({
            ...params,
            secretManager,
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
    getBalances: async (assets, balanceType) => {
      const { selectors: { specificAssetsBalanceSelector } } =
        await getChainStore(await getChainInfo());

      return specificAssetsBalanceSelector(assets, balanceType);
    },
    getDepositPayload: async ({ asset, amount }: IDepositOperationParams) => {
      const chainInfo = await getChainInfo();
      const store = await getChainStore(chainInfo);
      const state = store.getState();
      const { chainId, entrypointAddress } = entrypointInfoSelector(state);
      const depositIndex = myDepositsCountSelector(state);
      const { precommitment } = await secretManager.getDepositSecrets({
        entrypointAddress,
        chainId,
        depositIndex,
      });

      return buildDepositPayload(precommitment, asset, amount, entrypointAddress);
    },
    getWithdrawalPayloads: async ({
      asset,
      amount,
      recipient,
    }: IWithdrawapOperationParams): Promise<Array<StateWithdrawalPayload>> => {
      const chainInfo = await getChainInfo();
      const store = await getChainStore(chainInfo);

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

      if (!poolInfo) throw new Error(`No pool found for asset ${asset}`);

      const withdrawal = {
        processooor: addressToHex(params.entrypoint.address) as `0x${string}`,
        data: quote.feeCommitment.withdrawalData as `0x${string}`,
      };
      const context = BigInt(calculateContext(withdrawal, poolInfo.scope));

      const withdrawResultAction = await store.dispatch(
        withdrawThunk({
          getNextNote: store.selectors.getNextNote,
          proverFactory: params.proverFactory,
          asset,
          amount: amount ?? 0n,
          recipient,
          context,
        }),
      );

      const withdrawProofResult = unwrapResult(withdrawResultAction);

      return [{
        withdrawalInfo: {
          context,
          scope: poolInfo.scope,
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
      const store = await getChainStore(chainInfo);

      const unapprovedNotes = assets.length > 0
        ? store.selectors.getUnapprovedNotesByAsset(assets)
        : store.selectors.getUnapprovedNotes();

      if (unapprovedNotes.length === 0) return [];

      const ragequitResults = await Promise.all(
        unapprovedNotes.map(async (note) => {
          const resultAction = await store.dispatch(
            ragequitThunk({ note, proverFactory: params.proverFactory }),
          );

          if (resultAction.meta.requestStatus === "rejected") {
            console.warn(`Failed to generate ragequit proof for note ${note.label}`);

            return null;
          }

          return unwrapResult(resultAction);
        }),
      );

      return ragequitResults
        .filter((result): result is NonNullable<typeof result> => result !== null)
        .map(({ note, poolAddress, proofResult }) => ({ note, poolAddress, proofResult }));
    },
    getRagequitByLabelPayloads: async ({
      labels = [],
    }: IRagequitLabelsOperationParams): Promise<StateRagequitPayload[]> => {
      const chainInfo = await getChainInfo();
      const store = await getChainStore(chainInfo);

      const allNotes = store.selectors.getAllNotes();

      if (allNotes.length === 0) return [];

      const ragequitResults = await Promise.all(
        allNotes
          .filter(note => labels.includes(note.label))
          .map(async (note) => {
            const resultAction = await store.dispatch(
              ragequitThunk({ note, proverFactory: params.proverFactory }),
            );

            if (resultAction.meta.requestStatus === "rejected") {
              console.warn(`Failed to generate ragequit proof for note ${note.label}`);

              return null;
            }

            return unwrapResult(resultAction);
          }),
      );

      return ragequitResults
        .filter((result): result is NonNullable<typeof result> => result !== null)
        .map(({ note, poolAddress, proofResult }) => ({ note, poolAddress, proofResult }));
    },
    getNotes: async ({
      includeSpent = false,
      assets = [],
    }: IGetNotesParams): Promise<INote[]> => {
      const store = await getChainStore(await getChainInfo());
      let notes = store.selectors.getAllNotes();

      if (!includeSpent) {
        notes = notes.filter(note => note.balance > 0n);
      }

      if (assets.length > 0) {
        const assetSet = new Set(assets);

        notes = notes.filter(note => assetSet.has(note.assetAddress));
      }

      return notes;
    },
    dumpState: () => getAllStores(),
  };
};
