import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from 'ox/Provider';
import { raw } from '../src/raw';

const TX = `0x${'12'.repeat(32)}`;
const RECEIPT = { blockNumber: '0x123', status: '0x1', logs: [], gasUsed: '0x5208' };

describe('raw provider receipt waiting', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] });
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('can wait for a receipt included after the old ten-second limit', async () => {
        const request = vi.fn(async () => Date.now() >= 12_000 ? RECEIPT : null);
        const provider = raw({ request } as unknown as Provider, {
            waitForTransaction: { pollIntervalMs: 1_000, timeoutMs: 60_000 },
        });
        const outcome = provider.waitForTransaction(TX).then(
            () => 'included',
            () => 'timed out',
        );

        await vi.advanceTimersByTimeAsync(12_000);
        expect(await outcome).toBe('included');
        expect(request).toHaveBeenCalledTimes(13);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('settles at the deadline even when the receipt request never settles', async () => {
        const request = vi.fn(() => new Promise(() => undefined));
        const provider = raw({ request } as unknown as Provider, {
            waitForTransaction: { timeoutMs: 5_000 },
        });
        let state = 'pending';
        const outcome = provider.waitForTransaction(TX).then(
            () => { state = 'included'; },
            () => { state = 'timed out'; },
        );

        await vi.advanceTimersByTimeAsync(5_000);
        expect(state).toBe('timed out');
        await outcome;
        expect(request).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves the one-argument polling default', async () => {
        const request = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(RECEIPT);
        const provider = raw({ request } as unknown as Provider);
        const done = provider.waitForTransaction(TX);

        await vi.advanceTimersByTimeAsync(99);
        expect(request).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await expect(done).resolves.toBeUndefined();
        expect(request).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the default timeout when only the polling interval is supplied', async () => {
        const request = vi.fn().mockResolvedValue(null);
        const provider = raw({ request } as unknown as Provider, {
            waitForTransaction: { pollIntervalMs: 2_000 },
        });
        const done = provider.waitForTransaction(TX);
        const rejected = expect(done).rejects.toThrow(`Timed out waiting for transaction: ${TX}`);

        await vi.advanceTimersByTimeAsync(10_000);
        await rejected;
        expect(request).toHaveBeenCalledTimes(5);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the default polling interval when only the timeout is supplied', async () => {
        const request = vi.fn(async () => Date.now() >= 300 ? RECEIPT : null);
        const provider = raw({ request } as unknown as Provider, {
            waitForTransaction: { timeoutMs: 5_000 },
        });
        const done = provider.waitForTransaction(TX);

        await vi.advanceTimersByTimeAsync(300);
        await expect(done).resolves.toBeUndefined();
        expect(request).toHaveBeenCalledTimes(4);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('treats a reverted receipt as included, without claiming execution succeeded', async () => {
        const request = vi.fn().mockResolvedValue({ ...RECEIPT, status: '0x0' });
        const provider = raw({ request } as unknown as Provider);

        await expect(provider.waitForTransaction(TX)).resolves.toBeUndefined();
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith({
            method: 'eth_getTransactionReceipt', params: [TX],
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('propagates an RPC error unchanged and clears waiting timers', async () => {
        const failure = Object.assign(new Error('RPC unavailable'), { code: -32000 });
        const request = vi.fn().mockResolvedValueOnce(null).mockRejectedValue(failure);
        const provider = raw({ request } as unknown as Provider);
        const rejected = expect(provider.waitForTransaction(TX)).rejects.toBe(failure);

        await vi.advanceTimersByTimeAsync(100);
        await rejected;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not start another poll after a timed-out request eventually resolves', async () => {
        const pending = Promise.withResolvers<unknown>();
        const request = vi.fn(() => pending.promise);
        const provider = raw({ request } as unknown as Provider, {
            waitForTransaction: { pollIntervalMs: 100, timeoutMs: 5_000 },
        });
        const rejected = expect(provider.waitForTransaction(TX)).rejects.toThrow(/Timed out/);

        await vi.advanceTimersByTimeAsync(5_000);
        await rejected;
        pending.resolve(null);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(request).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('handles an RPC rejection arriving after the wait has timed out', async () => {
        const pending = Promise.withResolvers<unknown>();
        const request = vi.fn(() => pending.promise);
        const provider = raw({ request } as unknown as Provider, {
            waitForTransaction: { timeoutMs: 5_000 },
        });
        const rejected = expect(provider.waitForTransaction(TX)).rejects.toThrow(/Timed out/);

        await vi.advanceTimersByTimeAsync(5_000);
        await rejected;
        pending.reject(new Error('late RPC failure'));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(request).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps concurrent waits independent', async () => {
        const otherTx = `0x${'34'.repeat(32)}`;
        const request = vi.fn(async (args: { params: unknown[] }) =>
            args.params[0] === TX || Date.now() >= 1_000 ? RECEIPT : null);
        const provider = raw({ request } as unknown as Provider, {
            waitForTransaction: { pollIntervalMs: 1_000, timeoutMs: 5_000 },
        });
        const first = provider.waitForTransaction(TX);
        let secondIncluded = false;
        const second = provider.waitForTransaction(otherTx).then(() => { secondIncluded = true; });

        await vi.advanceTimersByTimeAsync(0);
        await expect(first).resolves.toBeUndefined();
        expect(secondIncluded).toBe(false);
        await vi.advanceTimersByTimeAsync(1_000);
        await second;
        expect(secondIncluded).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ends at the deadline even when the next interval would be longer than the budget', async () => {
        const request = vi.fn().mockResolvedValue(null);
        const provider = raw({ request } as unknown as Provider, {
            waitForTransaction: { pollIntervalMs: 20_000, timeoutMs: 5_000 },
        });
        const rejected = expect(provider.waitForTransaction(TX)).rejects.toThrow(/Timed out/);

        await vi.advanceTimersByTimeAsync(5_000);
        await rejected;
        expect(request).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('spaces slow RPC calls from completion and never overlaps receipt polls', async () => {
        const starts: number[] = [];
        let active = 0;
        let peakActive = 0;
        const request = vi.fn(() => {
            starts.push(Date.now());
            active += 1;
            peakActive = Math.max(peakActive, active);

            return new Promise((resolve) => setTimeout(() => {
                active -= 1;
                resolve(starts.length === 1 ? null : RECEIPT);
            }, 2_000));
        });
        const provider = raw({ request } as unknown as Provider, {
            waitForTransaction: { pollIntervalMs: 4_000, timeoutMs: 10_000 },
        });
        const done = provider.waitForTransaction(TX);

        await vi.advanceTimersByTimeAsync(8_000);
        await expect(done).resolves.toBeUndefined();
        expect(starts).toEqual([0, 6_000]);
        expect(peakActive).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not accept a receipt that arrives at the deadline', async () => {
        const request = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(RECEIPT), 5_000)));
        const provider = raw({ request } as unknown as Provider, {
            waitForTransaction: { timeoutMs: 5_000 },
        });
        const rejected = expect(provider.waitForTransaction(TX)).rejects.toThrow(/Timed out/);

        await vi.advanceTimersByTimeAsync(5_000);
        await rejected;
        expect(request).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('enforces the deadline when a pre-existing receipt timer runs before the timeout callback', async () => {
        const receipt = new Promise((resolve) => setTimeout(() => resolve(RECEIPT), 5_000));
        const request = vi.fn(() => receipt);
        const provider = raw({ request } as unknown as Provider, {
            waitForTransaction: { timeoutMs: 5_000 },
        });
        const rejected = expect(provider.waitForTransaction(TX)).rejects.toThrow(/Timed out/);

        await vi.advanceTimersByTimeAsync(5_000);
        await rejected;
        expect(request).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        { field: 'pollIntervalMs' as const, value: 0 },
        { field: 'pollIntervalMs' as const, value: -1 },
        { field: 'pollIntervalMs' as const, value: 0.5 },
        { field: 'timeoutMs' as const, value: Number.NaN },
        { field: 'timeoutMs' as const, value: Number.POSITIVE_INFINITY },
        { field: 'timeoutMs' as const, value: 2_147_483_648 },
    ])('rejects invalid $field=$value before making an RPC request', ({ field, value }) => {
        const request = vi.fn();

        expect(() => raw({ request } as unknown as Provider, {
            waitForTransaction: { [field]: value },
        })).toThrow(RangeError);
        expect(request).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
