import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMimcMerkleTree } from '@kohaku-eth/mimc-tree';

// Enough leaves for the parallel builder to start workers (above its 128-parent threshold).
const leaves = Array.from({ length: 512 }, (_, i) => BigInt(i + 1));
const expectedRoot = createMimcMerkleTree(leaves).root;

// A Web Worker whose module fails to load: it reports an error and never answers.
class FailingWorker {
  static created = 0;
  static posted = 0;
  #listeners = new Map<string, Array<(event: { message: string }) => void>>();

  constructor() {
    FailingWorker.created++;
    setTimeout(() => this.#listeners.get('error')?.forEach((listener) => listener({ message: 'load failed' })));
  }

  addEventListener(type: string, listener: (event: { message: string }) => void) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  removeEventListener() {}
  postMessage() {
    FailingWorker.posted++;
  }

  terminate() {}
}

// Fresh modules per test, so the fallback latch and the library's worker pool start clean.
const loadBuildTree = async () =>
  (await import('../../src/utils/merkle-tree/merkle-tree.util.browser')).buildTree;

describe('browser buildTree', () => {
  beforeEach(() => {
    vi.resetModules();
    FailingWorker.created = 0;
    FailingWorker.posted = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds on the main thread when Web Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const buildTree = await loadBuildTree();

    expect((await buildTree(leaves)).root).toBe(expectedRoot);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('falls back when workers fail to load and stops using them afterwards', async () => {
    vi.stubGlobal('Worker', FailingWorker);
    const buildTree = await loadBuildTree();

    expect((await buildTree(leaves)).root).toBe(expectedRoot);
    expect(FailingWorker.created).toBeGreaterThan(0);
    expect(console.warn).toHaveBeenCalledOnce();

    const posted = FailingWorker.posted;

    // The library keeps the dead pool cached, so later builds must not send it work.
    expect((await buildTree(leaves)).root).toBe(expectedRoot);
    expect(FailingWorker.posted).toBe(posted);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('rejects oversized leaf sets without giving up on workers', async () => {
    vi.stubGlobal('Worker', FailingWorker);
    const buildTree = await loadBuildTree();

    await expect(buildTree(new Array<bigint>(2 ** 20 + 1).fill(1n))).rejects.toThrow('Tree is full');
    expect(console.warn).not.toHaveBeenCalled();

    await buildTree(leaves);
    expect(FailingWorker.created).toBeGreaterThan(0);
  });
});
