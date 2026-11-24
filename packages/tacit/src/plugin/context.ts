import { type TacitChainConfig } from "../config";
import { type PoolKeys } from "../crypto/address";
import { type TacitProver } from "../prover/snarkjs";
import { type TacitRelayerClient } from "../relayer/client";
import { type PoolSync } from "../sync/pool-sync";
import { type TacitMode } from "./types";

/** What a plugin instance is built from. */
export type TacitContext = {
  config: TacitChainConfig;
  keys: PoolKeys;
  asset: bigint;
  sync: PoolSync;
  prover: TacitProver;
  relayer?: TacitRelayerClient;
  mode: TacitMode;
};
