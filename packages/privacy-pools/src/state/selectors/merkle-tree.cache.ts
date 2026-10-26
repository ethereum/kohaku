import { LeanIMT } from "@zk-kit/lean-imt";

import { buildMerkleTree } from "../../utils/proof.util";

/**
 * In-process cache of built Merkle trees, derived from the minimal persisted
 * leaf state. The trees (and their intermediate poseidon nodes) live ONLY here —
 * never in Redux state and never in the persisted snapshot — so the permanence
 * layer stays minimal while root/proof reads avoid rebuilding from scratch.
 *
 * The full O(n)-hash build is paid once per tree (the bootstrap, on first access
 * after app launch). Subsequent growth is applied incrementally with
 * `tree.insert` (O(delta · log n)), since the state tree is append-only
 * (deposits add commitments; withdrawals never remove them).
 *
 * The cache is keyed per namespace ("state" per pool, "asp" per entrypoint). It
 * is process-global, so a stale entry could in principle be served to a second
 * store that shares a key but has a divergent leaf history (e.g. two forks in a
 * test). A cheap signature (leaf count + last leaf) detects divergence and
 * forces a full rebuild, and verifyRootsThunk independently checks every derived
 * root against chain before any proof is used — so a wrong tree cannot silently
 * produce a bad proof.
 */

interface CachedTree {
  count: number;
  last: bigint;
  tree: LeanIMT<bigint>;
}

const namespaces = new Map<string, Map<string, CachedTree>>();

function namespace(ns: string): Map<string, CachedTree> {
  let cache = namespaces.get(ns);

  if (!cache) {
    cache = new Map();
    namespaces.set(ns, cache);
  }

  return cache;
}

/**
 * Returns the Merkle tree for `leaves`, reusing a cached instance when `leaves`
 * is an append-only extension of what was last seen for `key`. Otherwise builds
 * a fresh tree (first access, or a divergent/shrunken leaf set).
 *
 * The append check only compares the count and the last leaf, so a set that
 * changed in the middle (an ASP revocation) can pass it. When the caller knows
 * the root the leaves should build, an extended tree with another root is
 * rebuilt from scratch.
 */
export function getIncrementalTree(
  ns: string,
  key: string,
  leaves: bigint[],
  expectedRoot?: bigint,
): LeanIMT<bigint> {
  const cache = namespace(ns);
  const cached = cache.get(key);

  const isAppendOf =
    cached !== undefined &&
    cached.count > 0 &&
    leaves.length >= cached.count &&
    leaves[cached.count - 1] === cached.last;

  if (cached && isAppendOf) {
    for (let i = cached.count; i < leaves.length; i++) {
      cached.tree.insert(leaves[i]!);
    }

    cached.count = leaves.length;
    cached.last = leaves[leaves.length - 1]!;

    if (expectedRoot === undefined || cached.tree.root === expectedRoot) {
      return cached.tree;
    }
  }

  const tree = buildMerkleTree(leaves);

  cache.set(key, {
    count: leaves.length,
    last: leaves[leaves.length - 1]!,
    tree,
  });

  return tree;
}
