import type { ExternalSyncProvider } from "@kohaku-eth/plugins";
import { toExternalSyncClient } from "@kohaku-eth/plugins";
import { toHex } from "viem";
import type { UtxoExternalSyncProvider } from "./lib";

/**
 * Bridges Kohaku's `Host.externalSyncProvider` into the WASM-facing
 * `UtxoExternalSyncProvider` interface. Drains `streamEvents` into an array
 * via the shared `toExternalSyncClient` helper (async iterators can't cross
 * the WASM boundary, same constraint tornado-cash has at its worker
 * boundary), and normalizes block numbers/params to what the Rust side
 * expects.
 */
export class ExternalSyncProviderAdapter implements UtxoExternalSyncProvider {
    private readonly client: ReturnType<typeof toExternalSyncClient>;

    constructor(provider: ExternalSyncProvider) {
        this.client = toExternalSyncClient(provider);
    }

    getEvents(chainId: `0x${string}`, address: `0x${string}`, fromBlock: bigint, toBlock: bigint) {
        return this.client.getEvents({
            chainId,
            address,
            fromBlock: toHex(fromBlock),
            toBlock: toHex(toBlock),
        });
    }

    async lastCoveredBlock(chainId: `0x${string}`, address: `0x${string}`): Promise<bigint> {
        return BigInt(await this.client.lastCoveredBlock({ chainId, address }));
    }
}
