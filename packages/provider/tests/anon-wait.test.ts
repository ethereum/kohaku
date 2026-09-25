import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WAIT_FOR_TRANSACTION, waitForReceipt } from '../src/anon/wait';

const TX = '0xabc';

/** Flushes pending microtasks so the loop reaches its next `setTimeout`. */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('anon waitForReceipt', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves as soon as a receipt is returned', async () => {
        const getReceipt = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ blockNumber: 1n });

        const done = waitForReceipt(TX, getReceipt, { pollIntervalMs: 4_000, timeoutMs: 60_000 });

        await flush();
        expect(getReceipt).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(4_000);
        expect(getReceipt).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(4_000);
        await expect(done).resolves.toBeUndefined();
        expect(getReceipt).toHaveBeenCalledTimes(3);
    });

    it('waits the configured interval between polls', async () => {
        const getReceipt = vi.fn().mockResolvedValue(null);

        const done = waitForReceipt(TX, getReceipt, { pollIntervalMs: 4_000, timeoutMs: 60_000 });

        done.catch(() => undefined);

        await flush();
        expect(getReceipt).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(3_999);
        expect(getReceipt).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(getReceipt).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(60_000);
    });

    it('throws a descriptive error once the timeout elapses', async () => {
        const getReceipt = vi.fn().mockResolvedValue(null);

        const done = waitForReceipt(TX, getReceipt, { pollIntervalMs: 1_000, timeoutMs: 5_000 });
        const rejection = expect(done).rejects.toThrow(`anon-rpc: timed out waiting for transaction ${TX} after 5000ms`);

        await vi.advanceTimersByTimeAsync(10_000);
        await rejection;

        // polls at t=0,1,2,3,4,5s; the poll at 5s does not exceed the budget yet, so one more at 6s
        expect(getReceipt.mock.calls.length).toBeGreaterThanOrEqual(6);
        expect(getReceipt.mock.calls.length).toBeLessThanOrEqual(7);
    });

    it('counts time spent inside a slow poll against the timeout', async () => {
        // Each poll takes 3s (Tor-like), interval 1s, budget 5s: poll 1 runs t=0..3, sleep to t=4, poll 2 ends at t=7 > 5, so it throws.
        const getReceipt = vi.fn(() => new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)));

        const done = waitForReceipt(TX, getReceipt, { pollIntervalMs: 1_000, timeoutMs: 5_000 });
        const rejection = expect(done).rejects.toThrow(/timed out/);

        await vi.advanceTimersByTimeAsync(20_000);
        await rejection;
        expect(getReceipt).toHaveBeenCalledTimes(2);
    });

    it('ships defaults sized for a Tor round trip and mainnet block time', () => {
        // Slower than one Tor round trip (~2s), faster than one block (12s).
        expect(DEFAULT_WAIT_FOR_TRANSACTION.pollIntervalMs).toBeGreaterThanOrEqual(2_000);
        expect(DEFAULT_WAIT_FOR_TRANSACTION.pollIntervalMs).toBeLessThan(12_000);
        // At least a handful of blocks.
        expect(DEFAULT_WAIT_FOR_TRANSACTION.timeoutMs).toBeGreaterThanOrEqual(5 * 12_000);
    });
});
