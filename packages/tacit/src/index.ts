export { createTacitBroadcaster, createTacitPlugin } from "./plugin/factory";
export { TacitPlugin } from "./plugin/base";
export type { TacitUnshieldOptions } from "./plugin/base";
export type {
  TacitAddress,
  TacitAssetAmount,
  TacitAssetId,
  TacitBalance,
  TacitBroadcaster,
  TacitInstance,
  TacitMode,
  TacitNote,
  TacitPluginParameters,
  TacitPrivateOperation,
  TacitPublicOperation,
  TacitSpendOptions,
} from "./plugin/types";

export { E_ADDRESS, TACIT_DERIVATION_PURPOSE, TacitArtifacts, TacitConfigs } from "./config";
export type { TacitChainConfig } from "./config";

export { TacitFeeError, TacitFragmentedBalanceError, TacitRelayerError, TacitStaleProofError } from "./errors";

export { createSnarkjsProver } from "./prover/snarkjs";
export type { Groth16Result, ProverFactory, TacitProver } from "./prover/snarkjs";
export { loadArtifacts } from "./prover/artifacts";
export type { ProverArtifacts, VerifyingKey } from "./prover/artifacts";
