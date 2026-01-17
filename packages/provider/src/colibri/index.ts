import { raw } from '../raw';
import type { EthereumProvider } from '../provider';
import type { C4Config, default as Colibri, EIP1193Client } from '@corpus-core/colibri-stateless';

export type ColibriConfig = Partial<C4Config>;

type ColibriConstructor = new (config?: ColibriConfig) => Colibri;

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
  * Passed through to `new Colibri(...)`.
  * See Colibri-Stateless JS/TS docs for supported fields.
  */
export const colibri = async (config: ColibriConfig): Promise<EthereumProvider<Colibri>> => {
    const createColibri = await importColibri();
    const client = new createColibri(config);

    return {
        ...raw(client as unknown as EIP1193Client),
        _internal: client,
    }
}
