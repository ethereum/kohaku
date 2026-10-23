import { anon } from '@kohaku-eth/provider/anon';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';
// Workers from anon-rpc/known-workers.json (both mainnet):
// passthrough demonstrates sandbox + hash pinning; tor-js is a full Tor
// client in WASM reached through a demo KPS gateway (may be down).
const WORKERS = {
    passthrough: {
        specifier: '0x4fd77be300f31c5fe6ab266d35d27750a3478d27',
        config: undefined as unknown,
    },
    tor: {
        specifier: '0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e',
        config: { gateways: ['170.64.236.147:12298:uEiBHwUMNRTetrbqScahm81Di57Xv2OphNrx-CurJGOq3ww'] },
    },
};
const flavor = new URLSearchParams(location.search).get('worker') === 'tor' ? 'tor' : 'passthrough';
const { specifier: SPECIFIER, config: WORKER_CONFIG } = WORKERS[flavor];
const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

declare global {
    interface Window { __poc?: Record<string, unknown> }
}

const out = document.getElementById('out') as HTMLPreElement;
const log = (line: string): void => {
    out.textContent += `${line}\n`;
    console.log(`[poc] ${line}`);
};

let bootstrapCalls = 0;

const jsonRpc = async (method: string, params?: unknown[]): Promise<unknown> => {
    const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // eslint-disable-next-line no-restricted-syntax
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const body = await res.json() as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message ?? 'rpc error');
    return body.result;
};

const timeIt = async (fn: () => Promise<unknown>): Promise<number> => {
    const t = performance.now();
    await fn();
    return performance.now() - t;
};

const main = async (): Promise<void> => {
    log(`worker flavor: ${flavor}`);
    log(`bootstrap: reading specifier ${SPECIFIER} through ${RPC_URL}`);

    const t0 = performance.now();
    const provider = await anon({
        specifier: SPECIFIER,
        rpcUrl: RPC_URL,
        workerConfig: WORKER_CONFIG,
        bootstrap: {
            request: ({ method, params }) => {
                bootstrapCalls += 1;
                return jsonRpc(method, params);
            },
        },
    });
    const bootstrapMs = Math.round(performance.now() - t0);

    log(`worker ready in ${bootstrapMs}ms — bundle fetched from on-chain resolvers, `
        + `keccak256-verified, booted in a null-origin sandboxed iframe `
        + `(${bootstrapCalls} bootstrap eth_calls)`);

    const chainId = await provider.getChainId();
    const block = await provider.getBlockNumber();
    const gasPrice = await provider.getGasPrice();
    const balance = await provider.getBalance(VITALIK);

    log(`through the sandbox: chainId=${chainId} block=${block} `
        + `gasPrice=${gasPrice} vitalik.eth=${balance} wei`);

    const runs = 5;
    let directMs = 0;
    let anonMs = 0;
    for (let i = 0; i < runs; i += 1) {
        directMs += await timeIt(() => jsonRpc('eth_blockNumber'));
    }
    for (let i = 0; i < runs; i += 1) {
        anonMs += await timeIt(() => provider.request({ method: 'eth_blockNumber', params: undefined }));
    }
    const directAvgMs = Math.round(directMs / runs);
    const anonAvgMs = Math.round(anonMs / runs);

    log(`latency (eth_blockNumber ×${runs}): direct fetch avg ${directAvgMs}ms, `
        + `through anon-rpc sandbox avg ${anonAvgMs}ms (+${anonAvgMs - directAvgMs}ms overhead)`);

    window.__poc = {
        ok: true,
        chainId: Number(chainId),
        block: Number(block),
        gasPriceWei: gasPrice.toString(),
        vitalikBalanceWei: balance.toString(),
        bootstrapMs,
        bootstrapCalls,
        directAvgMs,
        anonAvgMs,
    };
};

main().catch((err: unknown) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    log(`FAILED: ${message}`);
    window.__poc = { ok: false, error: message };
});
