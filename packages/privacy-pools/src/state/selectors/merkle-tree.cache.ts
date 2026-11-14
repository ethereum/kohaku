import { buildMerkleTree, type MerkleTree, type MerkleTreeBuilder } from "../../utils/proof.util";

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

/*
 * Builds are async, so entries hold the tree's promise. count/last are updated
 * synchronously and appends are chained onto that promise: concurrent callers
 * share one build, and inserts apply in order even while a build is in flight.
 */
interface CachedTree {
  count: number;
  last: bigint;
  tree: Promise<MerkleTree>;
}

// A builder can host remote trees: keep its cache separate from other hosts.
const caches = new WeakMap<MerkleTreeBuilder, Map<string, Map<string, CachedTree>>>();

function namespace(ns: string, builder: MerkleTreeBuilder): Map<string, CachedTree> {
  let namespaces = caches.get(builder);

  if (!namespaces) {
    namespaces = new Map();
    caches.set(builder, namespaces);
  }

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
  builder: MerkleTreeBuilder = buildMerkleTree,
): Promise<MerkleTree> {
  const cache = namespace(ns, builder);
  const cached = cache.get(key);

  const isAppendOf =
    cached !== undefined &&
    cached.count > 0 &&
    leaves.length >= cached.count &&
    leaves[cached.count - 1] === cached.last;

  if (cached && isAppendOf) {
    if (leaves.length > cached.count) {
      const delta = leaves.slice(cached.count);

      cached.tree = cached.tree.then(async (tree) => {
        for (const leaf of delta) {
          await tree.insert(leaf);
        }

        return tree;
      });
      cached.count = leaves.length;
      cached.last = leaves[leaves.length - 1]!;
      evictOnFailure(cache, key, cached);
    }

    if (expectedRoot === undefined) {
      return cached.tree;
    }

    return cached.tree.then((tree) =>
      tree.root === expectedRoot ? tree : rebuild(cache, key, leaves, builder),
    );
  }

  return rebuild(cache, key, leaves, builder);
}

function rebuild(cache: Map<string, CachedTree>, key: string, leaves: bigint[], builder: MerkleTreeBuilder): Promise<MerkleTree> {
  const entry: CachedTree = {
    count: leaves.length,
    last: leaves[leaves.length - 1]!,
    tree: Promise.resolve().then(() => builder(leaves)),
  };

  cache.set(key, entry);
  evictOnFailure(cache, key, entry);

  return entry.tree;
}

// A failed build or insert must not stay cached, or every later read rejects.
function evictOnFailure(cache: Map<string, CachedTree>, key: string, entry: CachedTree): void {
  const tree = entry.tree;

  tree.catch(() => {
    if (cache.get(key) === entry && entry.tree === tree) {
      cache.delete(key);
    }
  });
}
