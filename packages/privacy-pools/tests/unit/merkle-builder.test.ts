import { afterEach, describe, expect, it, vi } from 'vitest';
import { PoseidonT3LeanIMT } from '@kohaku-eth/poseidon-lean-imt';
import { PrivacyPoolsV1Protocol } from '../../src/plugin/base';
import type { IStateManager } from '../../src/plugin/interfaces/protocol-params.interface';
import { getIncrementalTree } from '../../src/state/selectors/merkle-tree.cache';
import { buildMerkleTree, PARALLEL_THRESHOLD, proofFromTree, type MerkleTree } from '../../src/utils/proof.util';
import { createMockHost } from '../utils/mock-host';

const leaves = Array.from({ length: PARALLEL_THRESHOLD }, (_, i) => BigInt(i + 1));
const reference = new PoseidonT3LeanIMT(leaves);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('worker fallback', () => {
  it('builds a large tree without attempting workers in MV3 / React Native', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('process', { ...process, versions: {} });
    const parallel = vi.spyOn(PoseidonT3LeanIMT, 'fromLeavesParallel').mockRejectedValue(new Error('worker unavailable'));
    const tree = await buildMerkleTree(leaves);

    expect(parallel).not.toHaveBeenCalled();
    expect(tree.root).toBe(reference.root);
    expect(PoseidonT3LeanIMT.verifyProof(tree.generateProof(100))).toBe(true);
  });

  it.each(['throws', 'rejects'])('falls back when worker startup %s', async (failure) => {
    const parallel = vi.spyOn(PoseidonT3LeanIMT, 'fromLeavesParallel');

    if (failure === 'throws') parallel.mockImplementation(() => { throw new Error('CSP blocked Worker'); });
    else parallel.mockRejectedValue(new Error('worker script failed to load'));

    const tree = await buildMerkleTree(leaves);

    expect(parallel).toHaveBeenCalledOnce();
    expect(tree.root).toBe(reference.root);
    expect(PoseidonT3LeanIMT.verifyProof(tree.generateProof(leaves.length - 1))).toBe(true);
  });

  it('keeps using the parallel build when it succeeds', async () => {
    vi.spyOn(PoseidonT3LeanIMT, 'fromLeavesParallel').mockResolvedValue(reference);
    expect(await buildMerkleTree(leaves)).toBe(reference);
  });
});

describe('custom tree builder', () => {
  // Simulates an RPC proxy: methods return promises, and insert updates a cached root.
  const proxy = (tree: PoseidonT3LeanIMT): MerkleTree => ({
    get root() { return tree.root; },
    indexOf: async (leaf) => tree.indexOf(leaf),
    generateProof: async (index) => tree.generateProof(index),
    insert: async (leaf) => { tree.insert(leaf); },
  });

  it('reuses an async tree for appends and produces valid proofs', async () => {
    const builder = vi.fn(async (values: bigint[]) => proxy(new PoseidonT3LeanIMT(values)));
    const initial = await getIncrementalTree('state', 'remote-pool', [1n, 2n], undefined, builder);
    const grown = await getIncrementalTree('state', 'remote-pool', [1n, 2n, 3n, 4n], undefined, builder);
    const proof = await proofFromTree(grown, 4n);

    expect(grown).toBe(initial);
    expect(builder).toHaveBeenCalledOnce();
    expect(grown.root).toBe(new PoseidonT3LeanIMT([1n, 2n, 3n, 4n]).root);
    expect(PoseidonT3LeanIMT.verifyProof({ ...proof, siblings: proof.siblings.slice(0, 2) })).toBe(true);
  });

  it('keeps separate hosts out of each other\'s caches', async () => {
    const first = vi.fn(async (values: bigint[]) => proxy(new PoseidonT3LeanIMT(values)));
    const second = vi.fn(async (values: bigint[]) => proxy(new PoseidonT3LeanIMT(values)));
    const a = await getIncrementalTree('asp', 'same-key', [10n, 20n], undefined, first);
    const b = await getIncrementalTree('asp', 'same-key', [10n, 20n], undefined, second);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(a).not.toBe(b);
  });

  it('retries a failed custom build instead of silently building in the caller', async () => {
    const builder = vi.fn(async (values: bigint[]) => proxy(new PoseidonT3LeanIMT(values)))
      .mockRejectedValueOnce(new Error('offscreen document disconnected'));

    await expect(getIncrementalTree('asp', 'retry', [10n, 20n], undefined, builder)).rejects.toThrow('disconnected');
    expect((await getIncrementalTree('asp', 'retry', [10n, 20n], undefined, builder)).root)
      .toBe(new PoseidonT3LeanIMT([10n, 20n]).root);
    expect(builder).toHaveBeenCalledTimes(2);
  });

  it('forwards the hook from the plugin constructor', () => {
    const merkleTreeBuilder = vi.fn(buildMerkleTree);
    const stateManager = vi.fn(() => ({}) as IStateManager);

    new PrivacyPoolsV1Protocol(createMockHost(), {
      entrypoint: { address: 900n, deploymentBlock: 0n },
      stateManager,
      merkleTreeBuilder,
    });

    expect(stateManager).toHaveBeenCalledWith(expect.objectContaining({ merkleTreeBuilder }));
  });
});
