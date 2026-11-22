import { createHeliosProvider, HeliosProvider } from "@a16z/helios";
import type { Config, NetworkKind } from "@a16z/helios";
import { raw, RawProviderOptions } from "../raw";
import type { EthereumProvider } from "../provider";
import { Provider } from "ox/Provider";

type RpcResponse = { result?: unknown; error?: { message?: unknown } };

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
                // Error statuses often come from a proxy or rate limiter with a non-JSON body, so
                // their body is optional. On a successful status a read or parse failure is real.
                const body = await res.json().catch((err: unknown) => {
                    if (res.ok) throw err;
                }) as RpcResponse | null | undefined;

                const rpcMessage = body?.error?.message;

                if (typeof rpcMessage === 'string' && rpcMessage !== '') throw new Error(rpcMessage);

                if (!res.ok) throw new Error(`eth_getLogs: execution RPC returned HTTP ${res.status}`);

                if (body?.error) throw new Error('eth_getLogs: execution RPC returned an error without a message');

                if (!Array.isArray(body?.result)) throw new Error('eth_getLogs: execution RPC returned no log array');

                return body.result;
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
 * @param options - Kohaku receipt polling settings, independent of the Helios configuration
 * @returns A promise that resolves to an EthereumProvider instance wrapping the HeliosProvider
 */
export async function helios(config: Config, kind: NetworkKind, bypassLogs = false, options: RawProviderOptions = {}): Promise<EthereumProvider<HeliosProvider>> {
    if (!config.executionRpc) {
        throw new Error('Unable to initialize Helios provider: executionRpc is required');
    }

    const client = await createHeliosProvider(config, kind);

    await client.waitSynced();

    const provider = bypassLogs
        ? bypassGetLogs(client, config.executionRpc)
        : client as unknown as Provider;

    return {
        ...raw(provider, options),
        _internal: client,
    };
}
