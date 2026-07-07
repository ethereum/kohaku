import {
    type CircuitManifest,
    type ICircuitArtifacts,
    type IHTTPClient,
    IpfsCircuitArtifacts,
} from "@privacy-pools-v2/sdk";

/**
 * Wire the SDK's {@link IpfsCircuitArtifacts} to fetch circuit WASM / proving keys
 * / verification keys through the wallet's own HTTP stack (the {@link KohakuHttpClient}).
 * The SDK loader verifies each artifact against its pinned CID (SHA-256 multihash)
 * before returning or caching — that is the FR-040 integrity check — and caches in
 * memory only, so nothing binary touches `host.storage` (FR-042).
 *
 * @param params gateway URLs (tried in order) + the pinned per-circuit CID manifest.
 * @param httpClient the host-backed HTTP client used for gateway fetches.
 */
export function createCircuitArtifacts(
    params: { gatewayUrls: string[]; manifest: CircuitManifest },
    httpClient: IHTTPClient,
): ICircuitArtifacts {
    return new IpfsCircuitArtifacts({
        ipfsGatewayUrls: params.gatewayUrls,
        circuitManifest: params.manifest,
        httpClient,
    });
}
