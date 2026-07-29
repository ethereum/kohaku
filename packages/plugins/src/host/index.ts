import { Hex } from "ox/Hex";
import { EthereumProvider } from "@kohaku-eth/provider";
export { MemoryStorage } from "./memory-storage";
export { MnemonicKeystore } from "./mnemonic-keystore";

export type Host = {
    network: Network;
    storage: Storage;
    keystore: Keystore;
    provider: EthereumProvider;
    /**
     * Optional source of pre-scraped, integrity-verified protocol events used to
     * speed up cold syncs. When present (and a plugin's sync range is large enough),
     * plugins stream the bulk of a pool's events from here instead of the chain,
     * then fetch only the remaining tail from `provider`.
     */
    externalSyncProvider?: ExternalSyncProvider;
};

/**
 * A raw, unparsed on-chain event as served by an {@link ExternalSyncProvider}.
 *
 * The shape mirrors the fields a consumer needs to decode a log
 * (`contractAddress`, `topics`, `data`) plus its position (`blockNumber`,
 * `logIndex`). Every field is 0x-prefixed, lowercased hex; `eventTopic` equals
 * `topics[0]`. Transaction hash / block hash are intentionally omitted — plugins
 * that need them must not rely on this source for them.
 */
export type ExternalRawEvent = {
    contractAddress: Hex;
    eventTopic: Hex;
    topics: Hex[];
    data: Hex;
    blockNumber: Hex;
    logIndex: Hex;
};

/**
 * Identifies a single pool/instance to an {@link ExternalSyncProvider}. The
 * provider is responsible for mapping this to its own internal keying.
 */
export type ExternalSyncPoolId = {
    chainId: Hex;
    address: Hex;
};

/**
 * Host-supplied source of pre-scraped protocol events, keyed per pool. A typical
 * implementation wraps a CDN-backed client that maps `(chainId, address)` to its
 * own protocol id.
 */
export type ExternalSyncProvider = {
    /**
     * Streams the raw events this provider has for the pool within the inclusive
     * block range `[fromBlock, toBlock]`, in ascending block order.
     */
    streamEvents(
        params: ExternalSyncPoolId & { fromBlock: Hex; toBlock: Hex },
    ): AsyncIterable<ExternalRawEvent>;

    /**
     * The lowest block this provider has data for on the given pool — roughly the
     * pool's deployment/registration block. Consumers use it as a scan-start hint.
     * @throws if the provider has no data for the pool.
     */
    firstCoveredBlock(params: ExternalSyncPoolId): Promise<Hex>;

    /**
     * The highest block this provider has data for on the given pool. Consumers
     * use it to decide where the chain must take over.
     * @throws if the provider has no data for the pool.
     */
    lastCoveredBlock(params: ExternalSyncPoolId): Promise<Hex>;
};

/**
 * Provides network access to plugins.
 */
export type Network = {
    /**
     * @throws {Error}
     */
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

/**
 * Provides persistent storage to plugins.
 * 
 * Host SHOULD implement secure, encrypted storage for storage of data
 * as some data written by plugins MAY be sensitive.
 * (ultimately, security/integrity of persisted data is determined by the Host implementation)
 * 
 */
export type Storage = {
    readonly _brand: 'Storage';

    /**
     * Sets a value in storage.
     * @throws {Error}
     */
    set(key: string, value: string): Promise<void>;

    /**
     * Gets a value from storage.
     *
     * @returns The value associated with the key, or null if the key does not exist.
     * @throws {Error}
     */
    get(key: string): Promise<string | null>;
};

/**
 * Provides access to the wallet's keystore for path derivation.
 * 
 * @todo Figure out how we can make this work for hardware wallets, expecially with
 * railgun which should be capable of working natively.
 */
export type Keystore = {
    /**
     * Derives a private key at the given BIP-32 path. Implementations MAY
     * restrict which paths are allowed. Once an implementation has decided on
     * a path, it MUST return the same key for subsequent calls with the same path.
     * 
     * @param path BIP-32 path to derive the key at.
     * @returns The derived private key as a hex string.
     */
    deriveAt(path: string): Promise<Hex>;
};
