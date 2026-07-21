/**
 * WALLET SIDE — this is the code a Kohaku-based wallet (e.g. the extension)
 * would actually write. It imports only `@kohaku-eth/*` packages; the
 * `@0xbow-io/privacy-pools-v2-sdk` never appears on this side (SC-001).
 *
 * A `Host` is the capability bundle the wallet hands to every plugin:
 * key derivation, persistent storage, chain access, and outbound HTTP.
 */
import type { Host, Storage as PluginStorage } from "@kohaku-eth/plugins";
import { MnemonicKeystore } from "@kohaku-eth/plugins";
import type { EthereumProvider } from "@kohaku-eth/provider";

/**
 * In-memory plugin storage. The real extension backs this with encrypted
 * `chrome.storage` (the Host contract is get/set-only; the plugin layers its
 * own tombstone deletes on top).
 */
export function createWalletStorage(): PluginStorage {
    const map = new Map<string, string>();

    return {
        _brand: "Storage",
        async set(key, value) {
            map.set(key, value);
        },
        async get(key) {
            return map.get(key) ?? null;
        },
    };
}

export type WalletHostConfig = {
    /** The wallet's BIP-39 seed phrase (the extension unlocks this from its vault). */
    mnemonic: string;
    /** Chain access — the extension wires its own RPC/light-client provider here. */
    provider: EthereumProvider;
    /**
     * Outbound HTTP for ASP / relayer / artifact fetches. The demo injects a
     * throwing fetch to prove the offline run touches no network; the extension
     * passes (a policy-wrapped) `fetch`.
     */
    fetchImpl?: Host["network"]["fetch"];
};

/** Assemble the Kohaku `Host` exactly as the extension would. */
export function createWalletHost(config: WalletHostConfig): Host {
    const fetchImpl =
        config.fetchImpl ??
        (async () => {
            throw new Error("sample app: network.fetch is disabled in the offline demo");
        });

    return {
        keystore: new MnemonicKeystore(config.mnemonic),
        storage: createWalletStorage(),
        provider: config.provider,
        network: { fetch: fetchImpl },
    };
}
