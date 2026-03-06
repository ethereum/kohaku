import {
  combineReducers,
  configureStore,
  Middleware,
  PayloadAction,
  ReducersMapObject
} from "@reduxjs/toolkit";

import { aspReducer } from "./slices/aspSlice";
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
import { updateRootEventsReducer } from "./slices/updateRootEventsSlice";
import { withdrawalsReducer } from "./slices/withdrawalsSlice";

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
  updateRootEvents: updateRootEventsReducer,
  sync: syncReducer,
 } as const;

export type RootState = ReturnType<ReturnType<typeof combineReducers<typeof reducers>>>;
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

type StoreShape = typeof reducers extends ReducersMapObject<infer StateType> ? StateType : never;

interface StoreFactoryParams {
  entrypointInfo: EntrypointInfoState;
  initialState?: StoreShape;
  logLevel?: 'verbose' | 'error' | 'off';
}

export const storeFactory = ({
  entrypointInfo,
  initialState,
  logLevel = 'error',
}: StoreFactoryParams) => {
  const store = configureStore({
    preloadedState: initialState,
    reducer: reducers,
    middleware: (getDefaultMiddleware) => {
      const defaultMiddleware = getDefaultMiddleware({
        serializableCheck: {
          ignoreActions: true,
        },
      });

      if (logLevel !== 'off') {
        defaultMiddleware.concat(loggerFactory(logLevel));
      }

      return defaultMiddleware;
    }
  });

  store.dispatch(setEntrypointInfo(entrypointInfo));

  return store;
};

export type AppDispatch = ReturnType<typeof storeFactory>["dispatch"];
