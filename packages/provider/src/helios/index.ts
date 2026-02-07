import { createHeliosProvider, HeliosProvider } from "@a16z/helios";
import type { Config, NetworkKind } from "@a16z/helios";
import { raw } from "../raw";
import type { EthereumProvider } from "../provider";
import { Provider } from "ox/Provider";

/**
 * Creates a Helios light client provider.
 * 
 * @param config - Configuration object for the provider
 * @param kind - The type of network to connect to
 * @returns A promise that resolves to an EthereumProvider instance wrapping the HeliosProvider
 */
export async function helios(config: Config, kind: NetworkKind): Promise<EthereumProvider<HeliosProvider>> {
    const client = await createHeliosProvider(config, kind);
 
    await client.waitSynced();

    return {
        ...raw(client as unknown as Provider),
        _internal: client,
    };
}
