import { Provider } from 'ox/Provider';
import { AnonRpcWorker } from '@anon-rpc/browser-harness';
import { EthereumProvider } from '..';
import { raw } from '../raw';

export type AnonBootstrapProvider = {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export type AnonConfig = {
    /** Address of the worker specifier contract (IWorkerSpecifier). */
    specifier: string;
    /** Destination JSON-RPC endpoint the worker will forward requests to. */
    rpcUrl: string;
    /** Opaque, network-defined worker config (e.g. tor-js gateway list). */
    workerConfig?: unknown;
    /** Existing provider used for the two specifier reads. Not anonymized. */
    bootstrap: AnonBootstrapProvider;
    /** The harness has no boot timeout of its own; a silent worker would hang forever. */
    bootTimeoutMs?: number;
};

type RpcErrorBody = { code?: number; message?: string; data?: unknown };

/**
 * Wraps an anon-rpc worker (sandboxed, hash-pinned anon-client, see
 * https://github.com/privacy-ethereum/anon-rpc) as an EthereumProvider.
 * Browser-only: the harness boots a Web Worker inside a null-origin iframe.
 */
export const anon = async (config: AnonConfig): Promise<EthereumProvider<AnonRpcWorker>> => {
    const worker = new AnonRpcWorker({
        address: config.specifier,
        config: config.workerConfig,
        preExisting: { rpcProvider: config.bootstrap },
    });

    await bootWithTimeout(worker, config.bootTimeoutMs ?? 120_000);

    let requestId = 0;

    const client = {
        async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
            const res = await worker.fetch(config.rpcUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                // eslint-disable-next-line no-restricted-syntax
                body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
            });

            if (!res.ok) {
                throw new Error(`anon-rpc: endpoint returned http ${res.status}`);
            }

            const body = await res.json() as { result?: unknown; error?: RpcErrorBody };

            if (body.error) {
                throw Object.assign(
                    new Error(body.error.message ?? 'anon-rpc: rpc error'),
                    { code: body.error.code, data: body.error.data },
                );
            }

            return body.result;
        },
    };

    return { ...raw(client as unknown as Provider), _internal: worker };
};

const bootWithTimeout = async (worker: AnonRpcWorker, ms: number): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            worker.close();
            reject(new Error(`anon-rpc: worker did not become ready within ${ms}ms`));
        }, ms);
    });

    try {
        await Promise.race([worker.ready, timeout]);
    } finally {
        clearTimeout(timer);
    }
};
