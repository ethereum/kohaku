/* eslint-disable max-lines */
import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { ChainId, Storage } from "@kohaku-eth/plugins";
import { Store, unwrapResult } from "@reduxjs/toolkit";

import { ISecretManager } from "../account/keys";
import { E_ADDRESS } from "../config";
import { IDataService } from "../data/interfaces/data.service.interface";
import { relayDataAbi } from "../data/abis/entrypoint.abi";
import { Address } from "../interfaces/types.interface";
import {
  IChainsPaymastersConfig,
  IDepositOperationParams,
  IEntrypoint,
  IEstimateUnshieldOperationParams,
  IGetNotesParams,
  INote,
  IExactWithdrawalOperationParams,
  IPaymasterWithdrawapOperationParams,
  IRagequitAssetsOperationParams,
  IRagequitLabelsOperationParams,
  IStateManager,
  IWithdrawapOperationParams,
  PPv1DevOptions,
  PPv1ShieldEstimate,
  PPv1UnshieldEstimate,
  StateExactWithdrawalPayload,
  StateRagequitPayload,
  StateWithdrawalPayload,
  StoreKey,
  StoreStorageKey,
} from "../plugin/interfaces/protocol-params.interface";
import { IRelayerClient } from "../relayer/interfaces/relayer-client.interface";
import { computeMinimumViableFee, reasonableGasUnits, TAIL_CALLS_DEFAULT_GAS } from "../paymaster/fee";
import { createPaymasterBundlerClient, getUserOperationGasPrice } from "../paymaster/utils";
import { addressToHex } from "../utils";
import { decodeRelayData, encodeRelayData } from "../utils/encoding.utils";
import { deductFeeBPS, sizeExactRelayerWithdrawal } from "../utils/fee.utils";
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
} from "./selectors/slices.selectors";
import { buildDepositPayload, myDepositsCountSelector } from "./selectors/deposits.selector";
import {
  IBalanceType,
  SpecificAssetBalanceFn,
  specificAssetsBalanceSelector,
} from "./selectors/balance.selector";
import { getNoteSelector } from "./selectors/notes.selector";
import { PublicRootState, RootState, storeFactory } from "./store";
import { paymasterWithdrawThunk } from "./thunks/paymasterWithdrawThunk";
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
  paymasterConfig?: IChainsPaymastersConfig;
  devOptions?: PPv1DevOptions;
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
  devOptions,
}: Pick<StoreFactoryParams, 'storageToSyncTo' | 'initialState' | 'secretManager' | 'devOptions'>) => {
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
          devOptions,
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
    getShieldEstimate: async ({ asset, amount }: IDepositOperationParams): Promise<PPv1ShieldEstimate> => {
      const { vettingFeeBPS, minimumDepositAmount } =
        await params.dataService.getPoolForAsset(params.entrypoint.address, asset);
      const { fee, net } = deductFeeBPS(amount, vettingFeeBPS);

      return { fee, netAmount: net, vettingFeeBPS, minimumDeposit: minimumDepositAmount };
    },
    getUnshieldEstimate: async ({
      asset,
      amount,
      recipient,
      mode = 'relayer',
      hasTailCalls = false,
      tailCallsGasEstimate,
    }: IEstimateUnshieldOperationParams): Promise<PPv1UnshieldEstimate> => {
      const chainInfo = await getChainInfo();

      if (mode === 'paymaster') {
        const paymasterConfig = params.paymasterConfig?.[Number(chainInfo.chainId)];

        if (!paymasterConfig) {
          throw new Error(`No paymaster config for chain ${chainInfo.chainId}`);
        }

        const { bundlerUrl, paymasterAddress } = paymasterConfig;
        const isERC20 = asset !== BigInt(E_ADDRESS);
        const {
          standard: { maxFeePerGas },
        } = await getUserOperationGasPrice(createPaymasterBundlerClient(bundlerUrl));
        // Mirrors paymasterWithdrawThunk's baseline: callGasLimit only covers tail calls.
        const gas = {
          ...reasonableGasUnits(isERC20),
          callGasLimit: hasTailCalls ? (tailCallsGasEstimate ?? TAIL_CALLS_DEFAULT_GAS) : 0n,
        };
        const gasFeeWei = computeMinimumViableFee(gas, maxFeePerGas);
        const fee = isERC20
          ? await params.dataService.quoteWeiInToken(BigInt(paymasterAddress) as Address, asset, gasFeeWei)
          : gasFeeWei;

        return { mode, fee, netAmount: amount - fee, gasFeeWei, maxFeePerGas };
      }

      const store = await getChainStore(chainInfo);
      const {
        quote: { feeCommitment },
        relayerId,
      } = unwrapResult(
        await store.dispatch(
          quoteThunk({
            relayerClient: params.relayerClient,
            relayers: params.relayersList,
            asset,
            amount,
            recipient,
          }),
        ),
      );
      // The fee actually charged on-chain is the one in the signed withdrawal data.
      const { relayFeeBps } = decodeRelayData(feeCommitment.withdrawalData as `0x${string}`);
      const { fee, net } = deductFeeBPS(amount, relayFeeBps);

      return {
        mode,
        fee,
        netAmount: net,
        feeBPS: relayFeeBps,
        relayerId,
        expiration: feeCommitment.expiration,
      };
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
    getExactWithdrawalPayloads: async ({
      asset,
      recipient,
      requestedNet,
      gasBumpBPS,
    }: IExactWithdrawalOperationParams): Promise<StateExactWithdrawalPayload> => {
      const chainInfo = await getChainInfo();
      const store = await getChainStore(chainInfo);

      const quoteResultAction = await store.dispatch(
        quoteThunk({
          relayerClient: params.relayerClient,
          relayers: params.relayersList,
          asset,
          amount: requestedNet,
          recipient,
        }),
      );

      if (quoteResultAction.meta.requestStatus === "rejected") {
        throw new Error("Failed to get quote from relayers");
      }

      const { quote, relayerId } = unwrapResult(quoteResultAction);
      const poolInfo = store.selectors.poolFromAssetSelector(asset);

      if (!poolInfo) throw new Error(`No pool found for asset ${asset}`);

      // Reuse the relayer's recipient/feeRecipient, but decompose its quoted fee into
      // the fixed base rate and the (size-independent) gas cost, then size the gross so
      // the on-chain deduction leaves exactly `requestedNet`. Because we choose both the
      // gross and the embedded fee, the recipient's net is fixed here; the relayer can
      // only accept or reject (it accepts any embedded fee at or above its live rate).
      //
      // Only the gas term is volatile between quote and submission, so `gasBumpBPS` adds
      // headroom to it alone — not the relayer's margin. sizeExactRelayerWithdrawal keeps
      // the embedded fee at or below the on-chain maxRelayFeeBPS (the Entrypoint reverts
      // above it).
      const { maxRelayFeeBPS } = await params.dataService.getPoolForAsset(params.entrypoint.address, asset);
      const quoted = decodeRelayData(quote.feeCommitment.withdrawalData as `0x${string}`);
      const baseFeeBPS = BigInt(quote.baseFeeBPS);
      const gasQuoteBPS = quoted.relayFeeBps > baseFeeBPS ? quoted.relayFeeBps - baseFeeBPS : 0n;
      const gasMoney = deductFeeBPS(requestedNet, gasQuoteBPS).fee;
      const { grossAmount, feeBPS: relayFeeBps } = sizeExactRelayerWithdrawal({
        requestedNet,
        baseFeeBPS,
        gasMoney,
        gasBumpBPS,
        maxRelayFeeBPS,
      });

      const relayData = {
        recipient: quoted.recipient,
        feeRecipient: quoted.feeRecipient,
        relayFeeBps,
      };
      const withdrawal = {
        processooor: addressToHex(params.entrypoint.address) as `0x${string}`,
        data: encodeRelayData(relayData),
      };
      const context = BigInt(calculateContext(withdrawal, poolInfo.scope));

      const withdrawResultAction = await store.dispatch(
        withdrawThunk({
          getNextNote: store.selectors.getNextNote,
          proverFactory: params.proverFactory,
          asset,
          amount: grossAmount,
          recipient,
          context,
        }),
      );

      const proofResult = unwrapResult(withdrawResultAction);
      const { fee, net } = deductFeeBPS(grossAmount, relayFeeBps);

      return {
        payload: {
          withdrawalInfo: {
            context,
            scope: poolInfo.scope,
            relayDataAbi: JSON.stringify(relayDataAbi),
            relayDataObject: relayData,
            withdrawalObject: withdrawal,
          },
          proofResult,
          quoteData: { quote, relayerId },
          chainId: chainInfo.chainId,
        },
        exact: { grossAmount, requestedNet, expectedNet: net, fee },
      };
    },
    getPaymasterWithdrawalPayloads: async ({
      asset,
      amount,
      recipient,
      delegation,
      tailCalls,
      tailCallsGasEstimate,
    }: IPaymasterWithdrawapOperationParams) => {
      const chainInfo = await getChainInfo();
      const store = await getChainStore(chainInfo);
      const paymasterConfig = params.paymasterConfig?.[Number(chainInfo.chainId)];

      if (!paymasterConfig) {
        throw new Error(`No paymaster config for chain ${chainInfo.chainId}`);
      }

      return unwrapResult(
        await store.dispatch(
          paymasterWithdrawThunk({
            getNextNote: store.selectors.getNextNote,
            proverFactory: params.proverFactory,
            dataService: params.dataService,
            secretManager,
            asset,
            amount,
            recipient,
            paymasterConfig,
            delegation,
            tailCalls,
            tailCallsGasEstimate,
          }),
        ),
      );
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
