import {
  combineReducers,
  configureStore,
  Middleware,
  PayloadAction,
  ReducersMapObject
} from "@reduxjs/toolkit";

import { assetsReducer } from "./slices/assetsSlice";
import { depositsReducer } from "./slices/depositsSlice";
import {
  protocolConfigReducer,
  ProtocolConfigState,
  setProtocolConfig,
} from "./slices/protocolConfigSlice";
import { poolsReducer } from "./slices/poolsSlice";
import { relayersReducer } from "./slices/relayersSlice";
import { syncReducer } from "./slices/syncSlice";
import { withdrawalsReducer } from "./slices/withdrawalsSlice";
import { userSecretsReducer } from "./slices/userSecretsSlice";

const reducers = {
  deposits: depositsReducer,
  withdrawals: withdrawalsReducer,
  assets: assetsReducer,
  pools: poolsReducer,
  relayers: relayersReducer,
  instanceRegistryInfo: protocolConfigReducer,
  sync: syncReducer,
  userSecrets: userSecretsReducer,
} as const;

export type RootState = ReturnType<ReturnType<typeof combineReducers<typeof reducers>>>;
export type PublicRootState = Omit<RootState, 'userSecrets'>;

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
    pools: { poolsTuples },
  } = api.getState();

  const transformedState = `
  Deposits: ${depositsTuples.length}
  Withdrawals: ${withdrawalsTuples.length}
  Pools: ${poolsTuples.length}
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
  protocolConfig: ProtocolConfigState;
  initialState?: Omit<StoreShape, 'userSecrets'>;
  logLevel?: 'verbose' | 'error' | 'off';
}

export const storeFactory = ({
  protocolConfig,
  initialState,
  logLevel = 'error',
}: StoreFactoryParams) => {
  const store = configureStore({
    preloadedState: initialState,
    reducer: reducers,
    middleware: (getDefaultMiddleware) => {
      const defaultMiddleware = getDefaultMiddleware({
        immutableCheck: false,
        serializableCheck: false,
      });

      if (logLevel !== 'off') {
        defaultMiddleware.concat(loggerFactory(logLevel));
      }

      return defaultMiddleware;
    }
  });

  store.dispatch(setProtocolConfig(protocolConfig));

  return store;
};

export type AppDispatch = ReturnType<typeof storeFactory>["dispatch"];
