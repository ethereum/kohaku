import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { helios } from '../src/helios';

const mocks = vi.hoisted(() => ({
    createHeliosProvider: vi.fn(),
    request: vi.fn(),
    waitSynced: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('@a16z/helios', () => ({ createHeliosProvider: mocks.createHeliosProvider }));

const HELIOS_CONFIG = { executionRpc: 'https://rpc.invalid', network: 'mainnet' };
const FILTER = { fromBlock: 1n, toBlock: 16n };
const LOG = {
    blockNumber: '0x10',
    topics: [],
    data: '0x',
    address: '0x0000000000000000000000000000000000000001',
    logIndex: '0x3',
    transactionHash: `0x${'ab'.repeat(32)}`,
};

describe('helios eth_getLogs bypass', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal('fetch', mocks.fetch);
        mocks.waitSynced.mockResolvedValue(undefined);
        mocks.createHeliosProvider.mockResolvedValue({
            request: mocks.request, waitSynced: mocks.waitSynced,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends eth_getLogs to the execution RPC instead of Helios', async () => {
        mocks.fetch.mockResolvedValue(Response.json({ jsonrpc: '2.0', result: [LOG] }));
        const provider = await helios(HELIOS_CONFIG, 'ethereum', true);

        const [log] = await provider.getLogs(FILTER);

        expect(log).toMatchObject({ blockNumber: 16n, logIndex: 3 });
        expect(mocks.fetch).toHaveBeenCalledWith(
            HELIOS_CONFIG.executionRpc, expect.objectContaining({ method: 'POST' }),
        );
        expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ method: 'eth_getLogs' });
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('reports an error status whose body is not JSON', async () => {
        mocks.fetch.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
        const provider = await helios(HELIOS_CONFIG, 'ethereum', true);

        await expect(provider.getLogs(FILTER)).rejects.toThrow('HTTP 502');
    });

    it.each([
        { message: 'rate limited' },
        { error: 'Too Many Requests' },
    ])('reports an error status whose JSON body has no RPC error message: %j', async (body) => {
        mocks.fetch.mockResolvedValue(Response.json(body, { status: 429 }));
        const provider = await helios(HELIOS_CONFIG, 'ethereum', true);

        await expect(provider.getLogs(FILTER)).rejects.toThrow('HTTP 429');
    });

    it('keeps the RPC error message when an error status carries one', async () => {
        mocks.fetch.mockResolvedValue(Response.json(
            { jsonrpc: '2.0', error: { code: -32005, message: 'query returned more than 10000 results' } },
            { status: 400 },
        ));
        const provider = await helios(HELIOS_CONFIG, 'ethereum', true);

        await expect(provider.getLogs(FILTER)).rejects.toThrow('query returned more than 10000 results');
    });

    it.each([
        { jsonrpc: '2.0', result: [], error: 'Too Many Requests' },
        { jsonrpc: '2.0', result: [], error: { code: -32005 } },
        { jsonrpc: '2.0', result: [], error: { code: -32005, message: '' } },
    ])('rejects a successful response whose error has no message: %j', async (body) => {
        mocks.fetch.mockResolvedValue(Response.json(body));
        const provider = await helios(HELIOS_CONFIG, 'ethereum', true);

        await expect(provider.getLogs(FILTER)).rejects.toThrow('error without a message');
    });

    it('keeps the parse error for a successful response that is not JSON', async () => {
        mocks.fetch.mockResolvedValue(new Response('<html>Sign in to the network</html>'));
        const provider = await helios(HELIOS_CONFIG, 'ethereum', true);

        await expect(provider.getLogs(FILTER)).rejects.toThrow(SyntaxError);
    });

    it.each([
        { jsonrpc: '2.0' },
        { jsonrpc: '2.0', result: null },
    ])('rejects a successful response without a log array: %j', async (body) => {
        mocks.fetch.mockResolvedValue(Response.json(body));
        const provider = await helios(HELIOS_CONFIG, 'ethereum', true);

        await expect(provider.getLogs(FILTER)).rejects.toThrow('no log array');
    });
});
