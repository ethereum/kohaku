import {
  combineReducers,
  configureStore,
  Middleware,
  PayloadAction,
  ReducersMapObject,
  StoreEnhancer,
} from "@reduxjs/toolkit";

import type { PPv1DevOptions } from "../plugin/interfaces/protocol-params.interface";
import { aspReducer } from "./slices/aspSlice";
import { aspReviewReducer } from "./slices/aspReviewSlice";
import { aspVerificationReducer } from "./slices/aspVerificationSlice";
import { assetsReducer } from "./slices/assetsSlice";
import { depositsReducer } from "./slices/depositsSlice";
import { entrypointDepositsReducer } from "./slices/entrypointDepositsSlice";
import {
  entrypointInfoReducer,
  EntrypointInfoState,
  setEntrypointInfo,
} from "./slices/entrypointInfoSlice";
import { poolsLeavesReducer } from "./slices/poolLeavesSlice";
import { poolsReducer } from "./slices/poolsSlice";
import { ragequitsReducer } from "./slices/ragequitsSlice";
import { syncReducer } from "./slices/syncSlice";
import { timestampsReducer } from "./slices/timestampsSlice";
import { updateRootEventsReducer } from "./slices/updateRootEventsSlice";
import { withdrawalsReducer } from "./slices/withdrawalsSlice";
import { userSecretsReducer } from "./slices/userSecretsSlice";

const reducers = {
  deposits: depositsReducer,
  entrypointDeposits: entrypointDepositsReducer,
  withdrawals: withdrawalsReducer,
  ragequits: ragequitsReducer,
  assets: assetsReducer,
  pools: poolsReducer,
  poolsLeaves: poolsLeavesReducer,
  entrypointInfo: entrypointInfoReducer,
  asp: aspReducer,
  aspReview: aspReviewReducer,
  aspVerification: aspVerificationReducer,
  updateRootEvents: updateRootEventsReducer,
  sync: syncReducer,
  userSecrets: userSecretsReducer,
  timestamps: timestampsReducer,
 } as const;

export type RootState = ReturnType<ReturnType<typeof combineReducers<typeof reducers>>>;
// What dumps and snapshots hold: no user secrets, no session-only verification,
// and no timestamps, which are saved under their own key (see chain-state.ts).
export type PublicRootState = Omit<RootState, 'userSecrets' | 'aspVerification' | 'timestamps'>;
// The slices every account of a chain sees alike (see chain-state.ts).
export type ChainRootState = Omit<RootState, 'userSecrets'>;
type LogLevel = 'error' | 'verbose' | 'off';

const loggerFactory: (logLevel: LogLevel) => Middleware<object, RootState> = (logLevel) => (api) => (next) => (action) => {
  const result = next(action);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const error = (action as any).error;

  const { type, payload } = action as PayloadAction<unknown>;
  const transformedAction = {
    action: type,
    payload: error || (payload instanceof Array ? { count: payload.length } : payload),
  };

  const {
    deposits: { depositsTuples },
    withdrawals: { withdrawalsTuples },
    ragequits: { ragequitsTuples },
    entrypointDeposits: { entrypointDepositsTuples },
    pools: { poolsTuples },
    asp: { leaves, aspTreeRoot },
    updateRootEvents: { lastUpdateRootEvent },
  } = api.getState();

  const transformedState = `
  Deposits: ${depositsTuples.length}
  Withdrawals: ${withdrawalsTuples.length}
  Ragequits: ${ragequitsTuples.length}
  EntrypointDeposits: ${entrypointDepositsTuples.length}
  Pools: ${poolsTuples.length}
  Synced ASP root: ${aspTreeRoot}
  Synced ASP leaves count: ${leaves.length}
  Latest known ASP root: ${lastUpdateRootEvent?.root}
  Latest known ASP root ipfs: ${lastUpdateRootEvent?.ipfsCID},
  `;

  if (logLevel === 'verbose' || logLevel === 'error' && error) {
    console.group(`action ${type}`);
    console.log("%c action", "color: #9E9E9E", transformedAction);
    console.log("%c next state", "color: #4CAF50", transformedState);
    console.groupEnd();
  }

  return result;
};

/**
 * Makes a store read its chain slices from `getChainState`, so an account holds
 * only references to them. Its own copies of those slices stay at their empty
 * initial state, as nothing dispatched to an account store touches them.
 */
const overlayChainState = (getChainState: () => ChainRootState): StoreEnhancer => (createStore) => (reducer, preloadedState) => {
  const store = createStore(reducer, preloadedState);
  let own: unknown;
  let chain: ChainRootState | undefined;
  let merged: unknown;

  return {
    ...store,
    getState: () => {
      const nextOwn = store.getState();
      const nextChain = getChainState();

      // A stable root keeps the selectors' argument memoization working.
      if (nextOwn !== own || nextChain !== chain) {
        own = nextOwn;
        chain = nextChain;
        merged = { ...nextOwn, ...nextChain };
      }

      return merged as typeof nextOwn;
    },
  };
};

type StoreShape = typeof reducers extends ReducersMapObject<infer StateType> ? StateType : never;

interface StoreFactoryParams {
  entrypointInfo: EntrypointInfoState;
  initialState?: StoreShape;
  logLevel?: 'verbose' | 'error' | 'off';
  devOptions?: PPv1DevOptions;
  /** Where the chain slices live when they are shared with other accounts. */
  getChainState?: () => ChainRootState;
}

export const storeFactory = ({
  entrypointInfo,
  initialState,
  logLevel = 'error',
  devOptions,
  getChainState,
}: StoreFactoryParams) => {
  const store = configureStore({
    preloadedState: initialState,
    reducer: reducers,
    middleware: (getDefaultMiddleware) => {
      const defaultMiddleware = getDefaultMiddleware({
        immutableCheck: devOptions?.enableImmutableCheck ?? false,
        serializableCheck: devOptions?.enableSerializableCheck
          ? { ignoreActions: true }
          : false,
      });

      if (logLevel !== 'off') {
        defaultMiddleware.concat(loggerFactory(logLevel));
      }

      return defaultMiddleware;
    },
    enhancers: (getDefaultEnhancers) =>
      getChainState ? getDefaultEnhancers().concat(overlayChainState(getChainState)) : getDefaultEnhancers(),
  });

  store.dispatch(setEntrypointInfo(entrypointInfo));

  return store;
};

export type AppDispatch = ReturnType<typeof storeFactory>["dispatch"];
