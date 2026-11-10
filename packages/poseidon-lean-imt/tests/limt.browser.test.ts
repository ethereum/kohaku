// fromLeavesParallel on module Web Workers, against dist so the default worker
// URL is the one consumers get.

import { describe, expect, it } from 'vitest';
import { PoseidonT3LeanIMT as LeanIMT } from '../dist/index.js';

const range = (n: number) => Array.from({ length: n }, (_, i) => BigInt(i + 1));

describe('fromLeavesParallel in the browser', () => {
  it('builds the same tree as the sequential build on Web Workers', async () => {
    const Native = globalThis.Worker;
    let started = 0;

    globalThis.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        started++;
      }
    };

    try {
      const leaves = range(1025);
      const tree = await LeanIMT.fromLeavesParallel(leaves, { workers: 4 });

      expect(tree.root).toBe(new LeanIMT(leaves).root);
    } finally {
      globalThis.Worker = Native;
    }

    expect(started).toBe(4);
  });
});
