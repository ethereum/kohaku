import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { helios } from '../src/helios';
import { anon } from '../src/anon';

const mocks = vi.hoisted(() => ({
    createHeliosProvider: vi.fn(),
    request: vi.fn(),
    waitSynced: vi.fn(),
    workerFetch: vi.fn(),
    workerClose: vi.fn(),
}));

vi.mock('@a16z/helios', () => ({ createHeliosProvider: mocks.createHeliosProvider }));
vi.mock('@anon-rpc/browser-harness', () => ({
    AnonRpcWorker: class {
        ready = Promise.resolve();
        fetch = mocks.workerFetch;
        close = mocks.workerClose;
    },
}));

const TX = `0x${'12'.repeat(32)}`;
const RECEIPT = { blockNumber: '0x123', status: '0x1', logs: [], gasUsed: '0x5208' };
const HELIOS_CONFIG = { executionRpc: 'https://rpc.invalid', network: 'mainnet' };
const ANON_CONFIG = {
    specifier: '0x0000000000000000000000000000000000000001',
    rpcUrl: 'https://rpc.invalid',
    bootstrap: { request: async () => undefined },
};

describe('adapter receipt waiting (SDK transports mocked)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] });
        vi.setSystemTime(0);
        vi.resetAllMocks();
        mocks.waitSynced.mockResolvedValue(undefined);
        mocks.createHeliosProvider.mockResolvedValue({
            request: mocks.request, waitSynced: mocks.waitSynced,
        });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('passes waiting options through Helios without adding them to SDK configuration', async () => {
        mocks.request.mockImplementation(async () => Date.now() >= 12_000 ? RECEIPT : null);
        const provider = await helios(HELIOS_CONFIG, 'ethereum', false, {
            waitForTransaction: { pollIntervalMs: 1_000, timeoutMs: 60_000 },
        });
        const done = provider.waitForTransaction(TX);

        await vi.advanceTimersByTimeAsync(12_000);
        await expect(done).resolves.toBeUndefined();
        expect(mocks.createHeliosProvider).toHaveBeenCalledWith(HELIOS_CONFIG, 'ethereum');
        expect(mocks.waitSynced).toHaveBeenCalledTimes(1);
        expect(mocks.request).toHaveBeenCalledTimes(13);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('still waits through Helios when the optional log bypass is enabled', async () => {
        mocks.request.mockResolvedValue(RECEIPT);
        const provider = await helios(HELIOS_CONFIG, 'ethereum', true, {
            waitForTransaction: { timeoutMs: 60_000 },
        });

        await expect(provider.waitForTransaction(TX)).resolves.toBeUndefined();
        expect(mocks.request).toHaveBeenCalledWith({
            method: 'eth_getTransactionReceipt', params: [TX],
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps anon defaults when only its polling interval is overridden', async () => {
        mocks.workerFetch.mockImplementation(async () => Response.json({
            result: Date.now() >= 12_000 ? RECEIPT : null,
        }));
        const provider = await anon({
            ...ANON_CONFIG, waitForTransaction: { pollIntervalMs: 2_000 },
        });
        const done = provider.waitForTransaction(TX);

        await vi.advanceTimersByTimeAsync(12_000);
        await expect(done).resolves.toBeUndefined();
        expect(mocks.workerFetch).toHaveBeenCalledTimes(7);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps anon four-second polling when only its timeout is overridden', async () => {
        mocks.workerFetch.mockImplementation(async () => Response.json({ result: null }));
        const provider = await anon({
            ...ANON_CONFIG, waitForTransaction: { timeoutMs: 10_000 },
        });
        const rejected = expect(provider.waitForTransaction(TX)).rejects.toThrow(/Timed out/);

        await vi.advanceTimersByTimeAsync(10_000);
        await rejected;
        expect(mocks.workerFetch).toHaveBeenCalledTimes(3);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds an anon receipt request that stalls without closing a shared worker', async () => {
        mocks.workerFetch.mockReturnValue(new Promise(() => undefined));
        const provider = await anon({
            ...ANON_CONFIG, waitForTransaction: { timeoutMs: 5_000 },
        });
        const rejected = expect(provider.waitForTransaction(TX)).rejects.toThrow(/Timed out/);

        await vi.advanceTimersByTimeAsync(5_000);
        await rejected;
        expect(mocks.workerFetch).toHaveBeenCalledTimes(1);
        expect(mocks.workerClose).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
