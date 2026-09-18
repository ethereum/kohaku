// The saga log source now lives in the package proper (core consumers can use it
// too). Tests hydrate a pinned fork, so they pass `headBlock` to clamp the saga
// stream and an explicit RPC `fallback`; both are supported by the core factory.
export {
  createSagaLogSource,
  createSagaDataService,
  type SagaLogSourceParams,
  type SagaDataServiceParams,
} from "../../src/data/saga-log-source";
