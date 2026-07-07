import type { Host } from "@kohaku-eth/plugins";
import { type KeystoreManager, type PoolSession, PoolSessionBuilder } from "@privacy-pools-v2/sdk";
import type { Address } from "viem";
import { KohakuHttpClient } from "./adapters/http.adapter";
import { KohakuRpcInteractor } from "./adapters/rpc.adapter";
import { KohakuStorageService } from "./adapters/storage.adapter";
import type { PPv2PluginParameters } from "./interfaces/plugin.interface";

/**
 * Placeholder RPC URL. `PoolSessionBuilderConfig` requires `rpcUrl` even though we
 * override the RPC interactor via `.withRpcInteractor()`, so it is never used for
 * network access (DEP-7). Syntactically valid to pass the builder's schema.
 */
const PLACEHOLDER_RPC_URL = "http://rpc.invalid";

/**
 * Assemble the single SDK {@link PoolSession} for a plugin instance from `Host`
 * capabilities plus parameters (R1, FR-003). Contract addresses default from the
 * SDK `DEPLOYMENTS[chainId]` when `deployment` is omitted; circuit artifacts are
 * builder-constructed from `circuitGatewayUrls` + `circuitManifest`, fetched
 * through the injected {@link KohakuHttpClient} (T018). No wallet interactor is
 * wired, so the SDK's self-submission paths stay unavailable and the plugin can
 * never sign a transaction (INV-1).
 */
export async function assemblePoolSession(
    host: Host,
    params: PPv2PluginParameters,
    keystoreManager: KeystoreManager,
): Promise<PoolSession> {
    const builder = PoolSessionBuilder.fromConfig({
        chainId: Number(params.chainId),
        rpcUrl: PLACEHOLDER_RPC_URL,
        ownerAddress: params.ownerAddress as Address,
        ...(params.deployment ? { deployment: params.deployment } : {}),
        aspUrl: params.asp.baseUrl,
        ...(params.asp.publicKey ? { aspPublicKey: params.asp.publicKey } : {}),
        relayers: params.relayers,
        circuitGatewayUrls: params.artifacts.gatewayUrls,
        circuitManifest: params.artifacts.manifest,
    })
        .withHttpClient(new KohakuHttpClient(host.network))
        .withRpcInteractor(new KohakuRpcInteractor(host.provider))
        .withStorageService(new KohakuStorageService(host.storage, params.storeKey))
        .withKeystoreManager(keystoreManager);

    return builder.create();
}
