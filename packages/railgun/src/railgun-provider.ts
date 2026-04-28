import { Host } from "@kohaku-eth/plugins";
import { RailgunPlugin } from "./plugin";
import { RailgunPluginState, STATE_KEY } from "./state";
import { JsPoiProvider, JsSigner, JsSyncer } from "./pkg/railgun_rs";
import { EthereumProviderAdapter } from "./ethereum-provider";
import { GrothProverAdapter, RemoteArtifactLoader } from "./prover-adapter";
import { SignerPool } from "./signer-pool";

export async function loadRailgunProvider(host: Host): Promise<RailgunPlugin> {
    const savedState = host.storage.get(STATE_KEY);

    if (!savedState) {
        throw new Error("No saved state found for Railgun plugin");
    }

    const { providerState, internalSigners, chainId }: RailgunPluginState = JSON.parse(savedState);
    const remoteChainId = await host.provider.getChainId();

    if (remoteChainId !== chainId) {
        throw new Error(`Unexpected chain ID: remote: ${remoteChainId}, expected: ${chainId}`);
    }

    const provider = await newRailgunProvider(host, chainId);

    provider.setState(providerState);

    if (internalSigners.length === 0) {
        throw new Error("No internal signers found in saved state");
    }

    const primary = new JsSigner(internalSigners[0]!.spendingKey, internalSigners[0]!.viewingKey, chainId);
    const pool = new SignerPool(primary);

    for (const signer of internalSigners.slice(1)) {
        pool.add(new JsSigner(signer.spendingKey, signer.viewingKey, chainId));
    }

    const plugin = new RailgunPlugin(chainId, provider, pool, host.storage);

    for (const signer of internalSigners) {
        plugin.addInternalSigner(signer.spendingKey, signer.viewingKey);
    }

    return plugin;
}

export async function newRailgunProvider(host: Host, chain_id: bigint): Promise<JsPoiProvider> {
    const ARTIFACTS_URL = "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/";
    const rpcAdapter = new EthereumProviderAdapter(host.provider);
    const prover = new GrothProverAdapter(new RemoteArtifactLoader(ARTIFACTS_URL));
    const syncer = JsSyncer.newChained([
        JsSyncer.newSubsquid(chain_id),
        //? Since all the broadcasters & POI nodes rely on subsquid, there's no 
        //? actual sense in us syncing past subsquid.  So no need to have a RPC
        //? syncer that goes ahead
    ]);

    return await JsPoiProvider.new(rpcAdapter, syncer, prover);
}