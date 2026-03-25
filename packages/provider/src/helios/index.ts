import { createHeliosProvider, HeliosProvider } from "@a16z/helios";
import type { Config, NetworkKind } from "@a16z/helios";
import { raw } from "../raw";
import type { EthereumProvider } from "../provider";
import { Provider } from "ox/Provider";

function bypassGetLogs(client: HeliosProvider, rpcUrl: string) {
    let nextId = 1;

    return {
        async request(req: { method: string; params: unknown[] }) {
            if (req.method === 'eth_getLogs') {
                const res = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // eslint-disable-next-line no-restricted-syntax -- JSON-RPC requires `id`
                    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: req.method, params: req.params }),
                });
                const { result, error } = await res.json();

                if (error) throw new Error(error.message);

                return result;
            }

            return client.request(req);
        },
    } as unknown as Provider;
}

/**
 * Creates a Helios light client provider.
 *
 * @param config - Configuration object for the provider
 * @param kind - The type of network to connect to
 * @param bypassLogs - When true, `eth_getLogs` requests are proxied directly to the
 *   execution RPC URL instead of going through Helios. When false (default), all requests
 *   go through the light client — note that `eth_getLogs` is only possible for requests
 *   within the latest 8,191 blocks range and it may be very slow. It does not suit tasks like indexer sync.
 * @returns A promise that resolves to an EthereumProvider instance wrapping the HeliosProvider
 */
export async function helios(config: Config, kind: NetworkKind, bypassLogs = false): Promise<EthereumProvider<HeliosProvider>> {
    if (!config.executionRpc) {
        throw new Error('Unable to initialize Helios provider: executionRpc is required');
    }

    const client = await createHeliosProvider(config, kind);

    await client.waitSynced();

    const provider = bypassLogs
        ? bypassGetLogs(client, config.executionRpc)
        : client as unknown as Provider;

    return {
        ...raw(provider),
        _internal: client,
    };
}
