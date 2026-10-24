import { UnsupportedChainError, type Host } from "@kohaku-eth/plugins";
import { TACIT_DERIVATION_PURPOSE, TacitConfigs } from "../config";
import { keysFromIdentity } from "../crypto/address";
import { unhex } from "../crypto/bytes";
import { poolAsset } from "../pool/witness";
import { loadArtifacts } from "../prover/artifacts";
import { createSnarkjsProver } from "../prover/snarkjs";
import { TacitRelayerClient } from "../relayer/client";
import { PoolSync } from "../sync/pool-sync";
import { stateKey } from "../sync/store";
import { TacitPlugin } from "./base";
import { TacitRelayerBroadcaster } from "./broadcaster";
import { type TacitBroadcaster, type TacitPluginParameters } from "./types";

export const createTacitBroadcaster = (host: Host): TacitBroadcaster => new TacitRelayerBroadcaster(host);

/**
 * Opens a wallet on the pool of the provider's chain. The identity key comes from the host's keystore at
 * `m/29793'/1'/{accountIndex}'` unless one is supplied, and every other key derives from it, so the keystore's seed
 * is the only thing to back up.
 */
export async function createTacitPlugin(host: Host, params: TacitPluginParameters = {}): Promise<TacitPlugin> {
  const chainId = Number(await host.provider.getChainId());
  const config = params.config ?? TacitConfigs[chainId];

  if (!config || config.chainId !== chainId) throw new UnsupportedChainError(BigInt(chainId));

  const identity = params.identityKey ?? (await host.keystore.deriveAt(`m/${TACIT_DERIVATION_PURPOSE}'/1'/${params.accountIndex ?? 0}'`));
  const keys = keysFromIdentity(unhex(identity));
  const mode = params.mode ?? (config.relayerUrl ? "relayer" : "self");

  if (config.relayerUrl && !config.relayerAddress) {
    throw new Error("tacit: config.relayerUrl needs config.relayerAddress, the address it must quote from");
  }

  if (mode === "relayer" && !config.relayerUrl) throw new Error(`tacit: chain ${chainId} has no relayer; use mode self`);

  const relayer = config.relayerUrl ? new TacitRelayerClient(host.network, config, config.relayerUrl) : undefined;
  const asset = poolAsset({ chainId, pool: config.pool });

  const storageKey = stateKey(config, keys.address);
  const sync = new PoolSync({ provider: host.provider, storage: host.storage, config, keys, asset, relayer, storageKey });
  const proverFactory =
    params.proverFactory ?? (() => createSnarkjsProver({ artifacts: () => loadArtifacts(host.network), singleThread: params.singleThread }));

  return new TacitPlugin({ config, keys, asset, mode, relayer, sync, prover: await proverFactory() });
}
