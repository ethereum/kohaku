/**
 * WALLET SIDE — assembling `PPv2PluginParameters`.
 *
 * Everything deployment-specific comes in through these parameters so the
 * plugin hardcodes no environment (FR-002). All fields are plain JSON-able
 * data — no SDK value imports are needed to build them.
 */
import type { PPv2Factories, PPv2PluginParameters } from "@kohaku-eth/privacy-pools";
import type { Address } from "viem";

export const SEPOLIA_CHAIN_ID = 11155111n;

/**
 * Pinned circuit-artifact manifest (CID per circuit). In production the wallet
 * ships the full manifest for every circuit it uses and the plugin fetches +
 * integrity-checks the artifacts from the IPFS gateways (FR-040, DEP-3). The
 * demo injects a proof-service factory, so these are never fetched.
 */
export const CIRCUIT_MANIFEST = {
    transact_1x1: {
        wasm: "bafkreiesi2bkdwkqjzipx5oczraupyma77l7owo57qf7jsw4jsofi5sh2a",
        provingKey: "bafkreieyo6egnxzqgmd73vlddepe7rwonkqwzhfto64ujwiamks6thluce",
        verificationKey: "bafkreiai35msryolmahocnquqsjunrqnnqex3f5fuu4x23fkvbchl5xt5m",
    },
};

export type PluginConfig = {
    ownerAddress: Address;
    /**
     * Demo seam: the devnet's in-process ASP/relayer/prover/entrypoint. A
     * production wallet NEVER sets `factories` — it instead supplies real
     * `asp.baseUrl` (+ pinned `publicKey`, DEP-4) and a non-empty `relayers`
     * list (DEP-5), and the plugin builds the real HTTP/proving services.
     */
    factories?: PPv2Factories;
};

export function buildPluginParameters(config: PluginConfig): PPv2PluginParameters {
    return {
        chainId: SEPOLIA_CHAIN_ID,
        // The wallet account that signs public operations; also the instance id.
        ownerAddress: config.ownerAddress,
        // Contract addresses default from the SDK's DEPLOYMENTS map for this
        // chain; pass `deployment: {...}` to point at a custom deployment.
        asp: { baseUrl: "https://asp.demo.invalid" },
        relayers: [],
        artifacts: {
            gatewayUrls: ["https://ipfs.demo.invalid/ipfs"],
            manifest: CIRCUIT_MANIFEST,
        },
        ...(config.factories ? { factories: config.factories } : {}),
    };
}
