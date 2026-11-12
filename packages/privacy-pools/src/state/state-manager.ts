import type { EthereumProvider } from '@kohaku-eth/provider';
import { assertGasLimitsWithinBounds, assertGasPriceWithinBounds, readGasFeeReference } from '../paymaster/gas-bounds';
/* eslint-disable max-lines */
import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { Network, Storage } from "@kohaku-eth/plugins";
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
  IGetHistoryParams,
  IGetNotesParams,
  INote,
  IExactWithdrawalOperationParams,
  IPaymasterWithdrawapOperationParams,
  IRagequitAssetsOperationParams,
  IRagequitLabelsOperationParams,
  IStateManager,
  IWithdrawapOperationParams,
  PPv1DevOptions,
  PPv1HistoryEvent,
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
import { encodeRelayData } from "../utils/encoding.utils";
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
  IBalanceType,
  SpecificAssetBalanceFn,
  specificAssetsBalanceSelector,
} from "./selectors/balance.selector";
import { getNoteSelector } from "./selectors/notes.selector";
import { myHistorySelector } from "./selectors/history.selector";
import {
  ChainEntry,
  createChainEntries,
  GetChainStoreParams,
  getStoreKey,
  getStoreStorageKey,
  sharedChainEntries,
} from "./chain-state";
import { ChainRootState, PublicRootState, RootState, storeFactory } from "./store";
import { discoverUserSecretsThunk } from "./thunks/discoverUserSecretsThunk";
import { getDepositPayloadThunk } from "./thunks/getDepositPayloadThunk";
import { registerDepositIndexThunk } from "./thunks/registerDepositIndexThunk";
import { createLoadCache, createSkipAspSyncQueue } from "./utils/async.utils";
import { paymasterWithdrawThunk } from "./thunks/paymasterWithdrawThunk";
import { quoteThunk } from "./thunks/quoteThunk";
import { ragequitThunk } from "./thunks/ragequitThunk";
import { SyncAspThunkParams } from "./thunks/syncAspThunk";
import { SyncAspReviewThunkParams } from "./thunks/syncAspReviewThunk";
import { withdrawThunk } from "./thunks/withdrawThunk";
import { planObfuscatedBatchWithdrawal } from '../withdrawal/batch-plan';

export interface StoreFactoryParams extends SyncAspThunkParams, SyncAspReviewThunkParams {
  /** Supplied by the plugin, independently of a custom data service. */
  provider?: EthereumProvider;
  network?: Network;
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
  /**
   * Where the chain state is saved. Accounts given the same storage object
   * also share one copy of it in memory. By default the chain state goes to
   * `storageToSyncTo`, one copy per account.
   */
  chainStorage?: Storage;
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
      getHistory: () => myHistorySelector(store.getState()),
      myPoolsSelector: () => myPoolsSelector(store.getState()),
      poolFromAssetSelector: (assetAddress: Address) => poolFromAssetSelector(store.getState(), assetAddress),
      getUnapprovedNotes: () => unapprovedNotesSelector(store.getState()),
      getUnapprovedNotesByAsset: (assets: Address[]) =>
        unapprovedNotesByAssetSelector(store.getState(), assets),
    },
    getPublicState: (): PublicRootState => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { userSecrets, aspVerification, timestamps, ...publicState } = store.getState() as RootState;

      return publicState;
    },
  };
};

const NO_ASP_REVIEW: ChainRootState['aspReview'] = { flaggedTuples: [] };

/**
 * The chain state as an account without a review service sees it: no review
 * labels, even those another account sharing the chain state fetched. Built once
 * per chain state, so the account store keeps getting the same root back.
 */
const withoutAspReview = (getChainState: () => ChainRootState): (() => ChainRootState) => {
  let chain: ChainRootState | undefined;
  let view: ChainRootState | undefined;

  return () => {
    const next = getChainState();

    if (next !== chain || !view) {
      chain = next;
      view = { ...next, aspReview: NO_ASP_REVIEW };
    }

    return view;
  };
};

const storeByChainAndEntrypoint = ({
  secretManager,
  aspReviewService,
  devOptions,
  getChainEntry,
}: Pick<StoreFactoryParams, 'secretManager' | 'aspReviewService' | 'devOptions'> & {
  getChainEntry: (params: GetChainStoreParams) => Promise<ChainEntry>;
}) => {
  type ChainStore = ReturnType<typeof initializeSelectors<ReturnType<typeof storeFactory>>>;

  const chainStoreMap = new Map<StoreStorageKey, ChainStore>();
  const loadStore = createLoadCache<ChainStore>();

  const loadChainStore = async (getChainStoreParams: GetChainStoreParams): Promise<ChainStore> => {
    const {
      chainId,
      entrypoint: { address, deploymentBlock },
    } = getChainStoreParams;
    const chainEntry = await getChainEntry(getChainStoreParams);
    // Holds only the account's secrets, which are derived again on every load.
    const store = storeFactory({
      entrypointInfo: { chainId, entrypointAddress: address, deploymentBlock },
      devOptions,
      getChainState: aspReviewService ? chainEntry.getState : withoutAspReview(chainEntry.getState),
    });
    const storeWithSelectors = initializeSelectors({ store, secretManager });

    chainStoreMap.set(getStoreStorageKey(getChainStoreParams), storeWithSelectors);

    return storeWithSelectors;
  };

  return {
    getChainStore: (getChainStoreParams: GetChainStoreParams): Promise<ChainStore> =>
      loadStore(getStoreKey(getChainStoreParams), () => loadChainStore(getChainStoreParams)),
    getAllStores: (): ReturnType<IStateManager['dumpState']> => {
      return Array.from(chainStoreMap).reduce(
        (completeState, [storageKey, state]) => ({
          ...completeState,
          [storageKey]: state.getPublicState(),
        }),
        {} as ReturnType<IStateManager['dumpState']>,
      );
    },
  };
};

export const storeStateManager = (
  params: StoreFactoryParams,
): IStateManager => {
  const { storageToSyncTo, secretManager, initialState, devOptions } = params;
  const { chainStorage } = params;
  const chainEntries = chainStorage ? sharedChainEntries(chainStorage) : createChainEntries();
  const getChainEntry = (chainInfo: GetChainStoreParams) =>
    chainEntries.get(chainInfo, { storage: chainStorage ?? storageToSyncTo, initialState, devOptions });
  const { getChainStore, getAllStores } = storeByChainAndEntrypoint({ ...params, getChainEntry });

  const getChainInfo = async () => ({
    chainId: await params.dataService.getChainId(),
    entrypoint: params.entrypoint,
  });

  const planWithdrawal = (
    store: Awaited<ReturnType<typeof getChainStore>>,
    asset: Address, amount: bigint | undefined, batch = false, obfuscateAmounts = false,
  ) => {
    if (!obfuscateAmounts) return undefined;

    if (amount == null) throw new Error('Protected withdrawals require an explicit amount');

    const notes = planObfuscatedBatchWithdrawal(store.selectors.getAllNotes(), asset, amount);

    if (!batch && notes.length > 1) throw new Error('Protected withdrawal needs multiple notes: use paymaster mode with batch: true');

    return notes;
  };

  const runSync = async (chainInfo: GetChainStoreParams, skipAsp: boolean): Promise<void> => {
    const store = await getChainStore(chainInfo);
    const chainEntry = await getChainEntry(chainInfo);

    await chainEntry.sync({ ...params, skipAsp });
    unwrapResult(await store.dispatch(discoverUserSecretsThunk({ secretManager })));
  };

  // Sync, registration and shield preparation share one queue per store, because
  // they share a secret manager and read the state that the others change. Each
  // tail resolves, so a failed or cancelled operation does not block the next one.
  const operationTails = new Map<StoreKey, Promise<unknown>>();

  const serializeOperation = <T>(
    storeKey: StoreKey,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const result = (operationTails.get(storeKey) ?? Promise.resolve()).then(operation);

    operationTails.set(storeKey, result.catch(() => undefined));

    return result;
  };

  // At most one sync per account at a time: interleaved syncs would derive and
  // append the same note secrets twice.
  const syncQueues = new Map<StoreKey, ReturnType<typeof createSkipAspSyncQueue>>();

  return {
    sync: async ({ skipAsp = false } = {}): Promise<void> => {
      const chainInfo = await getChainInfo();
      const storeKey = getStoreKey(chainInfo);
      const enqueue = syncQueues.get(storeKey) ?? createSkipAspSyncQueue();

      syncQueues.set(storeKey, enqueue);

      return enqueue(skipAsp, (runSkipAsp) =>
        serializeOperation(storeKey, () => runSync(chainInfo, runSkipAsp))
      );
    },
    registerDepositIndex: async (depositIndex: number): Promise<boolean> => {
      const chainInfo = await getChainInfo();

      return serializeOperation(getStoreKey(chainInfo), async () => {
        const store = await getChainStore(chainInfo);

        return store.dispatch(
          registerDepositIndexThunk({ depositIndex, secretManager })
        );
      });
    },
    getBalances: async (assets, balanceType) => {
      const { selectors: { specificAssetsBalanceSelector } } =
        await getChainStore(await getChainInfo());

      return specificAssetsBalanceSelector(assets, balanceType);
    },
    getDepositPayload: async (request: IDepositOperationParams) => {
      const chainInfo = await getChainInfo();

      return serializeOperation(getStoreKey(chainInfo), async () => {
        const store = await getChainStore(chainInfo);

        return store.dispatch(
          getDepositPayloadThunk({ ...request, secretManager })
        );
      });
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
      maxGasLimits,
    }: IEstimateUnshieldOperationParams): Promise<PPv1UnshieldEstimate> => {
      const chainInfo = await getChainInfo();

      if (mode === 'paymaster') {
        const paymasterConfig = params.paymasterConfig?.[Number(chainInfo.chainId)];

        if (!paymasterConfig) {
          throw new Error(`No paymaster config for chain ${chainInfo.chainId}`);
        }

        const { bundlerUrl, paymasterAddress } = paymasterConfig;
        const isERC20 = asset !== BigInt(E_ADDRESS);
        const [{ standard: price }, reference] = await Promise.all([
          getUserOperationGasPrice(createPaymasterBundlerClient(bundlerUrl, params.network)),
          readGasFeeReference(params.provider),
        ]);

        assertGasPriceWithinBounds(price, reference);
        const { maxFeePerGas } = price;
        // Mirrors paymasterWithdrawThunk's baseline: callGasLimit only covers tail calls.
        const gas = {
          ...reasonableGasUnits(isERC20),
          callGasLimit: hasTailCalls ? (tailCallsGasEstimate ?? TAIL_CALLS_DEFAULT_GAS) : 0n,
        };

        assertGasLimitsWithinBounds(gas, gas, undefined, maxGasLimits);
        const gasFeeWei = computeMinimumViableFee(gas, maxFeePerGas);
        const fee = isERC20
          ? await params.dataService.quoteWeiInToken(BigInt(paymasterAddress) as Address, asset, gasFeeWei)
          : gasFeeWei;

        return { mode, fee, netAmount: amount - fee, gasFeeWei, maxFeePerGas };
      }

      const store = await getChainStore(chainInfo);
      const { maxRelayFeeBPS } = await params.dataService.getPoolForAsset(params.entrypoint.address, asset);
      const {
        quote: { feeCommitment },
        relayerId,
        relayData: { relayFeeBps },
      } = unwrapResult(
        await store.dispatch(
          quoteThunk({
            relayerClient: params.relayerClient,
            relayers: params.relayersList,
            asset,
            amount,
            recipient,
            maxRelayFeeBPS,
          }),
        ),
      );
      // The fee actually charged on-chain is the one in the signed withdrawal data.
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
      obfuscateAmounts,
    }: IWithdrawapOperationParams): Promise<Array<StateWithdrawalPayload>> => {
      const chainInfo = await getChainInfo();
      const store = await getChainStore(chainInfo);
      const note = planWithdrawal(store, asset, amount, false, obfuscateAmounts)?.[0]?.note;
      const { maxRelayFeeBPS } = await params.dataService.getPoolForAsset(params.entrypoint.address, asset);

      const quoteResultAction = await store.dispatch(
        quoteThunk({
          relayerClient: params.relayerClient,
          relayers: params.relayersList,
          asset,
          amount: amount ?? 0n,
          recipient,
          maxRelayFeeBPS,
        }),
      );

      if (quoteResultAction.meta.requestStatus === "rejected") {
        throw new Error("Failed to get quote from relayers");
      }

      // quoteThunk has checked that the relay data pays `recipient` within the quoted fee.
      const { quote, relayerId, relayData } = unwrapResult(quoteResultAction);
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
          merkleTreeBuilder: params.merkleTreeBuilder,
          asset,
          amount: amount ?? 0n,
          recipient,
          context,
          note,
        }),
      );

      const withdrawProofResult = unwrapResult(withdrawResultAction);

      return [{
        withdrawalInfo: {
          context,
          scope: poolInfo.scope,
          relayDataAbi: JSON.stringify(relayDataAbi),
          relayDataObject: relayData,
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
      obfuscateAmounts,
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

      const { quote, relayerId, relayData: quoted } = unwrapResult(quoteResultAction);
      const poolInfo = store.selectors.poolFromAssetSelector(asset);

      if (!poolInfo) throw new Error(`No pool found for asset ${asset}`);

      // Pay the caller's recipient and reuse the relayer's feeRecipient, but decompose its
      // quoted fee into the fixed base rate and the (size-independent) gas cost, then size
      // the gross so the on-chain deduction leaves exactly `requestedNet`. Because we choose
      // both the gross and the embedded fee, the recipient's net is fixed here; the relayer
      // can only accept or reject (it accepts any embedded fee at or above its live rate).
      //
      // Only the gas term is volatile between quote and submission, so `gasBumpBPS` adds
      // headroom to it alone — not the relayer's margin. sizeExactRelayerWithdrawal keeps
      // the embedded fee at or below the on-chain maxRelayFeeBPS (the Entrypoint reverts
      // above it).
      const { maxRelayFeeBPS } = await params.dataService.getPoolForAsset(params.entrypoint.address, asset);
      const quotedBaseFeeBPS = BigInt(quote.baseFeeBPS);
      // The base rate is self-reported; it cannot exceed the fee the relayer embedded.
      const baseFeeBPS = quotedBaseFeeBPS < quoted.relayFeeBps ? quotedBaseFeeBPS : quoted.relayFeeBps;
      const gasQuoteBPS = quoted.relayFeeBps > baseFeeBPS ? quoted.relayFeeBps - baseFeeBPS : 0n;
      const gasMoney = deductFeeBPS(requestedNet, gasQuoteBPS).fee;
      const { grossAmount, feeBPS: relayFeeBps } = sizeExactRelayerWithdrawal({
        requestedNet,
        baseFeeBPS,
        gasMoney,
        gasBumpBPS,
        maxRelayFeeBPS,
      });
      const note = planWithdrawal(store, asset, grossAmount, false, obfuscateAmounts)?.[0]?.note;

      const relayData = {
        recipient: addressToHex(recipient),
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
          merkleTreeBuilder: params.merkleTreeBuilder,
          asset,
          amount: grossAmount,
          recipient,
          context,
          note,
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
      maxGasLimits,
      batch,
      obfuscateAmounts,
      refundRecipient,
    }: IPaymasterWithdrawapOperationParams) => {
      const chainInfo = await getChainInfo();
      const store = await getChainStore(chainInfo);
      const paymasterConfig = params.paymasterConfig?.[Number(chainInfo.chainId)];

      if (!paymasterConfig) {
        throw new Error(`No paymaster config for chain ${chainInfo.chainId}`);
      }

      // Plan outside Redux so the structured headroom error reaches the caller intact.
      // Resolve randomness once and reuse the allocation for every fee/proof refinement.
      const notesToSpend = planWithdrawal(store, asset, amount, batch, obfuscateAmounts);

      return unwrapResult(
        await store.dispatch(
          paymasterWithdrawThunk({
            getNextNote: store.selectors.getNextNote,
            proverFactory: params.proverFactory,
            merkleTreeBuilder: params.merkleTreeBuilder,
            dataService: params.dataService,
            secretManager,
            asset,
            amount,
            recipient,
            paymasterConfig,
            delegation,
            tailCalls,
            tailCallsGasEstimate,
            maxGasLimits,
            provider: params.provider,
            network: params.network,
            batch,
            notesToSpend,
            refundRecipient,
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
    getHistory: async ({ assets = [] }: IGetHistoryParams): Promise<PPv1HistoryEvent[]> => {
      const chainInfo = await getChainInfo();
      const store = await getChainStore(chainInfo);

      // Always refreshed, whether or not the account has events: the RPC must not
      // be able to tell from history() calls who has activity, or where.
      await (await getChainEntry(chainInfo)).refreshTimestamps(params.dataService);

      const history = store.selectors.getHistory();

      if (assets.length === 0) return history;

      const assetSet = new Set(assets);

      return history.filter(event => assetSet.has(event.assetAddress));
    },
    dumpState: () => getAllStores(),
  };
};
