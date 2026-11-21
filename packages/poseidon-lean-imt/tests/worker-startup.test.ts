import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('terminates workers already started when a later constructor fails', async () => {
  const terminate = vi.fn();
  let started = 0;

  vi.stubGlobal('Worker', class {
    terminate = terminate;
    constructor() {
      if (++started === 2) throw new Error('CSP blocked the next worker');
    }
  });
  const { parallelLevels } = await import('../src/parallel');

  await expect(parallelLevels([1n, 2n, 3n, 4n], 2)).rejects.toThrow('CSP blocked');
  expect(terminate).toHaveBeenCalledOnce();
});

it('terminates the pool after a worker reports a script-load error', async () => {
  const terminate = vi.fn();
  const listeners = new Map<string, (event: unknown) => void>();

  vi.stubGlobal('Worker', class {
    terminate = terminate;
    addEventListener(name: string, listener: (event: unknown) => void) { listeners.set(name, listener); }
    removeEventListener(name: string) { listeners.delete(name); }
    postMessage() { queueMicrotask(() => listeners.get('error')?.({ message: 'script failed to load' })); }
  });
  const { parallelLevels } = await import('../src/parallel');

  await expect(parallelLevels([1n, 2n], 1)).rejects.toThrow('script failed');
  expect(terminate).toHaveBeenCalledOnce();
  expect(listeners.size).toBe(0);
});
