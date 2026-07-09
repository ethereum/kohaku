import type { Host } from "@kohaku-eth/plugins";
import {
    type INoteManager,
    type KeystoreManager,
    NoteManager,
    NoteStorageAdapter,
    type PoolSession,
    PoolSessionBuilder,
} from "@privacy-pools-v2/sdk";
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

/** The assembled session plus the note manager the plugin owns for balance/notes reads. */
export type AssembledSession = {
    session: PoolSession;
    /**
     * Plugin-owned note manager. The `PoolSession` facade exposes no note reads,
     * so the plugin injects its own manager (`.withNoteManager`) and reads through
     * it for `balance()`/`notes()`. `create()` calls `loadFromStorage()` on it.
     */
    noteManager: INoteManager;
};

/**
 * Assemble the single SDK {@link PoolSession} for a plugin instance from `Host`
 * capabilities plus parameters (R1, FR-003). Contract addresses default from the
 * SDK `DEPLOYMENTS[chainId]` when `deployment` is omitted; circuit artifacts are
 * builder-constructed from `circuitGatewayUrls` + `circuitManifest`, fetched
 * through the injected {@link KohakuHttpClient} (T018). No wallet interactor is
 * wired, so the SDK's self-submission paths stay unavailable and the plugin can
 * never sign a transaction (INV-1).
 *
 * The note manager is constructed here (over the same {@link KohakuStorageService})
 * and injected via `.withNoteManager` so the plugin retains a reference for reads.
 */
export async function assemblePoolSession(
    host: Host,
    params: PPv2PluginParameters,
    keystoreManager: KeystoreManager,
): Promise<AssembledSession> {
    const storageService = new KohakuStorageService(host.storage, params.storeKey);
    const noteManager = new NoteManager(
        {},
        {
            storageAdapter: new NoteStorageAdapter(
                Number(params.chainId),
                storageService,
                params.ownerAddress as Address,
            ),
        },
    );

    // Test-seam overrides (PPv2Factories) map onto builder `.withX()` calls; each
    // override makes its declarative config counterpart a builder conflict, so the
    // conflicting field is omitted here (aspClient ↔ aspUrl/aspPublicKey,
    // relayerInteractor ↔ relayers, entrypointInteractor ↔ deployment).
    const factories = params.factories ?? {};

    const builder = PoolSessionBuilder.fromConfig({
        chainId: Number(params.chainId),
        rpcUrl: PLACEHOLDER_RPC_URL,
        ownerAddress: params.ownerAddress as Address,
        ...(params.deployment && !factories.entrypointInteractor
            ? { deployment: params.deployment }
            : {}),
        // aspUrl conflicts with a data-provider override; with only an aspClient
        // override it must stay (the builder still resolves a data provider from it).
        ...(factories.aspDataProvider ? {} : { aspUrl: params.asp.baseUrl }),
        ...(params.asp.publicKey && !factories.aspClient
            ? { aspPublicKey: params.asp.publicKey }
            : {}),
        ...(factories.relayerInteractor ? {} : { relayers: params.relayers }),
        circuitGatewayUrls: params.artifacts.gatewayUrls,
        circuitManifest: params.artifacts.manifest,
    })
        .withHttpClient(new KohakuHttpClient(host.network))
        .withRpcInteractor(new KohakuRpcInteractor(host.provider))
        .withStorageService(storageService)
        .withNoteManager(noteManager)
        .withKeystoreManager(keystoreManager);

    if (factories.aspDataProvider) builder.withAspDataProvider(factories.aspDataProvider);

    if (factories.aspClient) builder.withAspClient(factories.aspClient);

    if (factories.relayerInteractor) builder.withRelayerInteractor(factories.relayerInteractor);

    if (factories.proofService) builder.withProofService(factories.proofService);

    if (factories.entrypointInteractor) {
        builder.withEntrypointInteractor(factories.entrypointInteractor);
    }

    const session = await builder.create();

    return { session, noteManager };
}
