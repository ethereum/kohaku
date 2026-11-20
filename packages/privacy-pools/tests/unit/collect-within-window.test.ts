import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectWithinWindow } from '../../src/state/utils/async.utils';

const never = new Promise<number>(() => {});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('collectWithinWindow', () => {
  it('leaves a rejected answer undefined and still settles', async () => {
    const collected = collectWithinWindow([Promise.resolve(1), Promise.reject(new Error('down'))], () => false, 5_000);

    await expect(collected).resolves.toEqual([1, undefined]);
  });

  it('a rejected answer does not start the window', async () => {
    let settled = false;
    const collected = collectWithinWindow([Promise.reject(new Error('down')), never], () => true, 5_000).finally(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);
    void collected;
  });

  it('closes the window after the first accepted answer, rejections aside', async () => {
    const collected = collectWithinWindow([Promise.reject(new Error('down')), Promise.resolve(1), never], () => true, 5_000);

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(collected).resolves.toEqual([undefined, 1, undefined]);
  });
});
