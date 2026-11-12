import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../../src/state/utils/async.utils';

// Settles only when its signal aborts, like a fetch to a stalled server.
const stalled = (signal: AbortSignal) => new Promise<never>((_, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason));
});

describe('withTimeout', () => {
  afterEach(() => vi.useRealTimers());

  it('returns what the run returns', async () => {
    await expect(withTimeout(1000, 'test', async () => 42)).resolves.toBe(42);
  });

  it('aborts and rejects a run that does not settle in time', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const result = withTimeout(1000, 'test', (s) => {
      signal = s;

      return new Promise(() => {});
    });
    const settled = expect(result).rejects.toThrow('test did not answer within 1000ms');

    await vi.advanceTimersByTimeAsync(1000);
    await settled;

    expect(signal?.aborted).toBe(true);
  });

  it('aborts the requests left running when the run fails early', async () => {
    let signal: AbortSignal | undefined;

    await expect(withTimeout(60_000, 'test', (s) => {
      signal = s;

      return Promise.all([Promise.reject(new Error('503')), stalled(s)]);
    })).rejects.toThrow('503');

    expect(signal?.aborted).toBe(true);
  });
});
