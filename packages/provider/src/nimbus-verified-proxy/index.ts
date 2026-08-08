import { raw } from '../raw';
import type { EthereumProvider } from '../provider';
import type { NVPConfig, NVPTransports, default as NimbusVerifiedProxy } from '@status-im/nimbus-verified-proxy';
import { Provider } from 'ox/Provider';

export type { NVPConfig, NVPTransports };

type NVPConstructor = new () => NimbusVerifiedProxy;

async function importNVP(): Promise<NVPConstructor> {
    const mod = (await import('@status-im/nimbus-verified-proxy')) as unknown as {
        default?: NVPConstructor;
    };
    if (!mod.default) {
        throw new Error(
            "Failed to import '@status-im/nimbus-verified-proxy' default export. " +
            "Ensure the package is installed and your bundler supports ESM default imports."
        );
    }

    return mod.default;
}

export const nvp = async (
    config: NVPConfig,
    transports?: NVPTransports,
): Promise<EthereumProvider<NimbusVerifiedProxy>> => {
    const createNVP = await importNVP();
    const client = new createNVP();
    await client.init(JSON.stringify(config), transports);

    const provider: Provider = {
        request: ({ method, params }) =>
            client.call(method, JSON.stringify(params ?? [])).then(r => JSON.parse(r)),
    };

    return {
        ...raw(provider),
        _internal: client,
    };
};
