import { Hex } from "viem";

export interface Host {
    network: Network;
    storage: Storage;
    secretStorage: SecretStorage;
    keystore: Keystore;
    ethProvider: EthProvider;
}

/**
 * Provides network access to plugins.
 */
export interface Network {
    /**
     * @throws {Error}
     */
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/**
 * Provides persistent insecure storage to plugins.
 * 
 * Plugins MUST assume that data written here is stored in plaintext.
 * 
 * Dedicated secure and insecure storage interfaces are provided to separate concerns and
 * reduce the amount of sensitive data implementers are required to handle.
 */
export interface Storage {
    readonly _brand: 'Storage';

    /**
     * Sets a value in storage.
     * @throws {Error}
     */
    set(key: string, value: string): void;

    /**
     * Gets a value from storage.
     * 
     * @returns The value associated with the key, or null if the key does not exist.
     * @throws {Error}
     */
    get(key: string): string | null;
}

/**
 * Provides persistent secure storage to plugins.
 * 
 * Implementations MUST ensure that data written here is encrypted at rest. 
 */
export interface SecretStorage {
    readonly _brand: 'SecureStorage';

    /**
     * Sets a value in storage.
     * @throws {Error}
     */
    set(key: string, value: string): void;

    /**
     * Gets a value from storage.
     * 
     * @returns The value associated with the key, or null if the key does not exist.
     * @throws {Error}
     */
    get(key: string): string | null;
}

/**
 * Provides access to the wallet's keystore for path derivation.
 * 
 * @todo Figure out how we can make this work for hardware wallets, expecially with
 * railgun which should be capable of working natively.
 */
export interface Keystore {
    /**
     * Derives a private key at the given BIP-32 path. Implementations MAY
     * restrict which paths are allowed. Once an implementation has decided on
     * a path, it MUST return the same key for subsequent calls with the same path.
     * 
     * @param path BIP-32 path to derive the key at.
     * @returns The derived private key as a hex string.
     */
    deriveAt(path: string): Hex;
}

/**
 * Provides access to an Ethereum provider for plugins.
 */
export interface EthProvider {
    /**
     * @throws {Error}
     */
    request(args: {
        method: string;
        params?: unknown[] | Record<string, unknown>
    }): Promise<unknown>;
}
