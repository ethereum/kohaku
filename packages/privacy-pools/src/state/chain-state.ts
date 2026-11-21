import { ChainId, Storage } from "@kohaku-eth/plugins";
import { unwrapResult } from "@reduxjs/toolkit";

import {
  IEntrypoint,
  PPv1DevOptions,
  StoreKey,
  StoreStorageKey,
} from "../plugin/interfaces/protocol-params.interface";
import { setVerifiedAspRoot } from "./slices/aspVerificationSlice";
import { ChainRootState, PublicRootState, RootState, storeFactory } from "./store";
import { IDataService } from "../data/interfaces/data.service.interface";
import { selectLastSyncedBlock } from "./selectors/last-synced-block.selector";
import { getPPv1ChainStateKey, getPPv1TimestampsKey } from "./storage-keys";
import { createLoadCache, createSkipAspSyncQueue, createSyncQueue } from "./utils/async.utils";
import { syncHistoryTimestampsThunk } from "./thunks/syncHistoryTimestampsThunk";
import { syncThunk, SyncThunkParams } from "./thunks/syncThunk";

export interface GetChainStoreParams {
  chainId: ChainId;
  entrypoint: IEntrypoint;
}

export const getStoreKey = ({
  chainId,
  entrypoint: { address },
}: GetChainStoreParams): StoreKey => `${chainId.toString()}-${address}`;

/** The key of a chain's state in dumps and `initialState` snapshots. */
export const getStoreStorageKey = (params: GetChainStoreParams): StoreStorageKey =>
  `privacy-pool-state-${getStoreKey(params)}`;

export interface ChainStateLoadParams {
  /** Where the chain state is loaded from and saved to. */
  storage?: Storage;
  initialState?: () => Promise<Record<string, PublicRootState>>;
  devOptions?: PPv1DevOptions;
}

export interface ChainEntry {
  /** The state as of the last sync that passed verification. */
  getState: () => ChainRootState;
  sync: (params: SyncThunkParams) => Promise<void>;
  /** Fetches the block timestamps history() needs up to the verified head. */
  refreshTimestamps: (dataService: IDataService) => Promise<void>;
}

const readJson = async <T>(storage: Storage | undefined, key: string): Promise<T | undefined> => {
  const raw = storage ? await storage.get(key) : null;

  return raw ? JSON.parse(raw) : undefined;
};

const loadChainEntry = async (
  params: GetChainStoreParams,
  { storage, initialState: initialStateCallback, devOptions }: ChainStateLoadParams,
): Promise<ChainEntry> => {
  const { chainId, entrypoint: { address, deploymentBlock } } = params;
  const stateKey = getPPv1ChainStateKey(chainId, address);
  const timestampsKey = getPPv1TimestampsKey(chainId, address);
  const storedState = await readJson<PublicRootState>(storage, stateKey);
  const timestamps = await readJson<RootState['timestamps']>(storage, timestampsKey);
  const initialState = storedState ?? (await initialStateCallback?.())?.[getStoreStorageKey(params)];
  const store = storeFactory({
    entrypointInfo: { chainId, entrypointAddress: address, deploymentBlock },
    initialState: { ...initialState, ...(timestamps && { timestamps }) } as RootState,
    devOptions,
  });

  // On-chain verification is per session: never take it from storage or a snapshot.
  store.dispatch(setVerifiedAspRoot(0n));

  const readChainState = (): ChainRootState => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { userSecrets, ...chainState } = store.getState();

    return chainState;
  };

  // Accounts read this, not the store: mid-sync the store holds events that are
  // not verified yet and no verified ASP root, which a withdrawal must not see.
  let published = readChainState();
  const enqueueSync = createSkipAspSyncQueue();
  // Apart from syncs: a queued follow-up runs the work of whoever queued it first.
  const enqueueTimestamps = createSyncQueue();

  return {
    getState: () => published,
    sync: ({ skipAsp = false, ...syncParams }) => enqueueSync(skipAsp, async (runSkipAsp) => {
      unwrapResult(await store.dispatch(syncThunk({ ...syncParams, skipAsp: runSkipAsp })));
      published = readChainState();

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { aspVerification, timestamps: _timestamps, ...publicState } = published;

      await storage?.set(stateKey, JSON.stringify(publicState));
    }),
    refreshTimestamps: (dataService) => enqueueTimestamps(async () => {
      const before = store.getState().timestamps;

      try {
        // The head of the verified state: a sync still running may have moved the store's.
        const head = selectLastSyncedBlock(published as RootState);

        unwrapResult(await store.dispatch(syncHistoryTimestampsThunk({ dataService, head })));
      } finally {
        // Batches fetched before a failure are kept, so the next call resumes.
        const { timestamps: after } = store.getState();

        if (after !== before) {
          // Only the timestamps: the rest of the store may be a sync's unverified state.
          published = { ...published, timestamps: after };
          await storage?.set(timestampsKey, JSON.stringify(after));
        }
      }
    }),
  };
};

/** The chain state of every chain and entrypoint, loaded on first use. */
export interface ChainEntries {
  get: (params: GetChainStoreParams, loadParams: ChainStateLoadParams) => Promise<ChainEntry>;
}

export const createChainEntries = (): ChainEntries => {
  const load = createLoadCache<ChainEntry>();

  return {
    get: (params, loadParams) => load(getStoreKey(params), () => loadChainEntry(params, loadParams)),
  };
};

// Weak, so the chain state goes once nothing holds its storage.
const chainEntriesByStorage = new WeakMap<Storage, ChainEntries>();

/**
 * The chain state saved in `chainStorage`, shared by every account given that
 * same storage object. Whichever account syncs reads the chain through its own
 * provider and every account relies on the result, so one chain storage must
 * only serve accounts that use the same provider.
 */
export const sharedChainEntries = (chainStorage: Storage): ChainEntries => {
  let entries = chainEntriesByStorage.get(chainStorage);

  if (!entries) {
    entries = createChainEntries();
    chainEntriesByStorage.set(chainStorage, entries);
  }

  return entries;
};
