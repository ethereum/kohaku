import { describe, expect, it, vi } from 'vitest';
import type { Provider } from 'ox/Provider';
import { raw } from '../src/raw';

const TX = `0x${'ab'.repeat(32)}`;

describe('raw provider logs', () => {
    it('keeps the log index and transaction hash', async () => {
        const request = vi.fn(async () => [{
            blockNumber: '0x10',
            topics: [],
            data: '0x',
            address: '0x0000000000000000000000000000000000000001',
            logIndex: '0x3',
            transactionHash: TX,
        }]);
        const [log] = await raw({ request } as unknown as Provider).getLogs({ fromBlock: 1n, toBlock: 16n });

        expect(log).toMatchObject({ blockNumber: 16n, logIndex: 3, transactionHash: TX });
    });
});
