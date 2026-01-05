import type { RailgunNetworkConfig } from '~/config';
import type { RailgunProvider } from './provider';
import { Eip1193ProviderAdapter, type Eip1193AdapterOptions, type Eip1193Provider } from './eip1193-adapter';
import type { C4Config } from '@corpus-core/colibri-stateless';

export type ColibriConfig = Partial<C4Config>;

export type RailgunRpcConfig =
    | ({
        type: 'colibri';
        /**
         * Passed through to `new Colibri(...)`.
         * See Colibri-Stateless JS/TS docs for supported fields.
         */
        colibri: ColibriConfig;
    } & Eip1193AdapterOptions)
    | ({
        type: 'eip1193';
        /**
         * Any EIP-1193 provider (e.g. `window.ethereum`).
         */
        provider: Eip1193Provider;
    } & Eip1193AdapterOptions);

type ColibriConstructor = new (config?: ColibriConfig) => Eip1193Provider;

async function importColibri(): Promise<ColibriConstructor> {
    // Colibri-Stateless exports the client as default export (ESM):
    // `export default class C4Client { ... }`
    const mod = (await import('@corpus-core/colibri-stateless')) as unknown as {
        default?: ColibriConstructor;
    };

    if (!mod.default) {
        throw new Error(
            "Failed to import '@corpus-core/colibri-stateless' default export. " +
            "Ensure the package is installed and your bundler supports ESM default imports."
        );
    }

    return mod.default;
}

/**
 * Creates a `RailgunProvider` from a high-level RPC config.
 * This keeps the public API ergonomic while preserving provider-injection flexibility.
 */
export async function createRailgunProviderFromRpc(
    network: RailgunNetworkConfig,
    rpc: RailgunRpcConfig,
): Promise<RailgunProvider> {
    switch (rpc.type) {
        case 'eip1193': {
            return new Eip1193ProviderAdapter(rpc.provider, {
                pollIntervalMs: rpc.pollIntervalMs,
                timeoutMs: rpc.timeoutMs,
            });
        }
        case 'colibri': {
            const Colibri = await importColibri();
            const config: ColibriConfig = { ...rpc.colibri };

            // Default chainId to the railgun network config (string is accepted by Colibri).
            if (config.chainId === undefined) {
                config.chainId = network.CHAIN_ID.toString();
            }

            const client = new Colibri(config);

            return new Eip1193ProviderAdapter(client, {
                pollIntervalMs: rpc.pollIntervalMs,
                timeoutMs: rpc.timeoutMs,
            });
        }
        default: {
            // Exhaustiveness guard
            const _exhaustive: never = rpc;
            throw new Error(`Unsupported rpc type: ${(_exhaustive as unknown as { type?: string }).type ?? 'unknown'}`);
        }
    }
}


