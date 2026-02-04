import { createHeliosProvider, HeliosProvider } from "@a16z/helios";
import type { Config, NetworkKind } from "@a16z/helios";
import { Eip1193Like, raw } from "~/raw";
import type { EthereumProvider } from "../provider";
export { createHeliosProvider as createHeliosProviderRaw } from "@a16z/helios";
export type { NetworkKind, Config, HeliosProvider, Network  } from "@a16z/helios";

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
        ...raw(client as unknown as Eip1193Like),
        _internal: client,
    };
}
