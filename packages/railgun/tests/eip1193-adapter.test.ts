import { describe, expect, it, vi } from 'vitest';
import { Eip1193ProviderAdapter, type Eip1193Provider } from '../src/provider/eip1193-adapter';

function makeMockProvider(impl: (args: { method: string; params?: unknown }) => unknown | Promise<unknown>) {
    const calls: Array<{ method: string; params?: unknown }> = [];
    const provider: Eip1193Provider = {
        request: async (args) => {
            calls.push({ method: args.method, params: args.params });
            return await impl({ method: args.method, params: args.params });
        },
    };
    return { provider, calls };
}

describe('Eip1193ProviderAdapter', () => {
    it('getBlockNumber maps eth_blockNumber and parses hex quantity', async () => {
        const { provider, calls } = makeMockProvider(({ method }) => {
            if (method === 'eth_blockNumber') return '0x10';
            throw new Error(`Unexpected method: ${method}`);
        });

        const adapter = new Eip1193ProviderAdapter(provider);
        await expect(adapter.getBlockNumber()).resolves.toBe(16);
        expect(calls).toEqual([{ method: 'eth_blockNumber', params: undefined }]);
    });

    it('getLogs maps eth_getLogs and omits empty address filter', async () => {
        const { provider, calls } = makeMockProvider(({ method, params }) => {
            if (method !== 'eth_getLogs') throw new Error(`Unexpected method: ${method}`);

            const [filter] = (params as unknown[]) ?? [];
            expect(filter).toEqual({ fromBlock: '0x1', toBlock: '0x2' });

            return [
                {
                    blockNumber: '0x2',
                    topics: ['0xabc'],
                    data: '0x',
                    address: '0x0000000000000000000000000000000000000001',
                },
            ];
        });

        const adapter = new Eip1193ProviderAdapter(provider);
        const logs = await adapter.getLogs({ address: '', fromBlock: 1, toBlock: 2 });

        expect(logs).toEqual([
            {
                blockNumber: 2,
                topics: ['0xabc'],
                data: '0x',
                address: '0x0000000000000000000000000000000000000001',
            },
        ]);
        expect(calls).toEqual([{ method: 'eth_getLogs', params: [{ fromBlock: '0x1', toBlock: '0x2' }] }]);
    });

    it('getTransactionReceipt maps and converts fields', async () => {
        const { provider } = makeMockProvider(({ method }) => {
            if (method !== 'eth_getTransactionReceipt') throw new Error(`Unexpected method: ${method}`);
            return {
                blockNumber: '0x5',
                status: '0x1',
                gasUsed: '0x5208',
                logs: [
                    {
                        blockNumber: '0x5',
                        topics: ['0x01', '0x02'],
                        data: '0xdeadbeef',
                        address: '0x0000000000000000000000000000000000000002',
                    },
                ],
            };
        });

        const adapter = new Eip1193ProviderAdapter(provider);
        const receipt = await adapter.getTransactionReceipt('0xhash');

        expect(receipt).toEqual({
            blockNumber: 5,
            status: 1,
            gasUsed: 0x5208n,
            logs: [
                {
                    blockNumber: 5,
                    topics: ['0x01', '0x02'],
                    data: '0xdeadbeef',
                    address: '0x0000000000000000000000000000000000000002',
                },
            ],
        });
    });

    it('waitForTransaction polls until receipt exists', async () => {
        vi.useFakeTimers();

        let polls = 0;
        const { provider } = makeMockProvider(({ method }) => {
            if (method !== 'eth_getTransactionReceipt') throw new Error(`Unexpected method: ${method}`);
            polls += 1;
            if (polls < 3) return null;
            return {
                blockNumber: '0x1',
                status: '0x1',
                gasUsed: '0x0',
                logs: [],
            };
        });

        const adapter = new Eip1193ProviderAdapter(provider, { pollIntervalMs: 10, timeoutMs: 1_000 });
        const p = adapter.waitForTransaction('0xhash');

        await vi.advanceTimersByTimeAsync(25);
        await expect(p).resolves.toBeUndefined();

        vi.useRealTimers();
    });
});


