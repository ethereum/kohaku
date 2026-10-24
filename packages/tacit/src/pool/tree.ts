import { poseidon } from "../crypto/poseidon";

export const TREE_DEPTH = 32;

/** The serialized form of an {@link IncTree}: decimal strings, so it survives JSON. */
export type IncTreeState = { size: number; root: string; filled: string[]; tracked: Record<string, string[]> };

export type IncTree = {
  readonly size: number;
  readonly root: bigint;
  /** Appends leaves at `size`; `track` names the absolute indices among them to keep a path for. */
  append(leaves: bigint[], track?: number[]): void;
  has(index: number): boolean;
  path(index: number): bigint[];
  /** Siblings from `level` 1 up to the root of the next pair slot, the path an insertion proves against. */
  insertionPath(): bigint[];
  untrack(index: number): void;
  toJSON(): IncTreeState;
  clone(): IncTree;
};

let cachedZeros: bigint[] | null = null;

/** The hash of an empty subtree at each level, 0 to {@link TREE_DEPTH}. */
export function emptyHashes(): bigint[] {
  if (!cachedZeros) {
    const zeros = [0n];

    for (let level = 1; level <= TREE_DEPTH; level++) zeros.push(poseidon([zeros[level - 1]!, zeros[level - 1]!]));

    cachedZeros = zeros;
  }

  return cachedZeros;
}

/**
 * The pool's Poseidon tree kept incrementally: its right edge, size and root, and the sibling path of each tracked
 * leaf. Memory stays small however large the pool grows, and a batch of n leaves costs about 2n hashes.
 */
export function incTree(state?: IncTreeState | null): IncTree {
  const zeros = emptyHashes();
  let size = state ? Number(state.size) : 0;
  let root = state ? BigInt(state.root) : zeros[TREE_DEPTH]!;
  const filled = state ? state.filled.map(BigInt) : zeros.slice(0, TREE_DEPTH);
  const tracked = new Map<number, (bigint | null)[]>(
    state ? Object.entries(state.tracked).map(([index, path]) => [Number(index), path.map(BigInt)]) : [],
  );

  function append(leaves: bigint[], track: number[] = []): void {
    const count = leaves.length;

    if (!count) return;

    const start = size;

    if (start + count > 2 ** TREE_DEPTH) throw new Error("tacit: tree full");

    for (const index of track) {
      if (index < start || index >= start + count) throw new Error("tacit: tracked index outside the batch");

      tracked.set(index, Array<bigint | null>(TREE_DEPTH).fill(null));
    }

    let level = leaves.slice();
    let lo = start;

    for (let depth = 0; depth < TREE_DEPTH; depth++) {
      const hi = lo + level.length - 1;
      const left = filled[depth]!;

      for (const [index, path] of tracked) {
        const sibling = Math.floor(index / 2 ** depth) ^ 1;

        if (sibling >= lo && sibling <= hi) path[depth] = level[sibling - lo]!;
        else if (path[depth] === null) path[depth] = sibling < lo ? left : zeros[depth]!;
      }

      const lastEven = hi % 2 === 0 ? hi : hi - 1;

      if (lastEven >= lo) filled[depth] = level[lastEven - lo]!;

      const nextLo = Math.floor(lo / 2);
      const nextHi = Math.floor(hi / 2);
      const next: bigint[] = [];

      for (let pair = nextLo; pair <= nextHi; pair++) {
        const l = 2 * pair < lo ? left : level[2 * pair - lo]!;
        const r = 2 * pair + 1 <= hi ? level[2 * pair + 1 - lo]! : zeros[depth]!;

        next.push(poseidon([l, r]));
      }

      level = next;
      lo = nextLo;
    }

    root = level[0]!;
    size = start + count;
  }

  const toJSON = (): IncTreeState => ({
    size,
    root: root.toString(),
    filled: filled.map(String),
    tracked: Object.fromEntries([...tracked].map(([index, path]) => [index, path.map(String)])),
  });

  return {
    get size() {
      return size;
    },
    get root() {
      return root;
    },
    append,
    has: (index) => tracked.has(index),
    path(index) {
      const path = tracked.get(index);

      if (!path) throw new Error("tacit: leaf is not tracked");

      return path.map((x) => x!);
    },
    insertionPath() {
      const out: bigint[] = [];

      for (let depth = 1; depth < TREE_DEPTH; depth++) out.push(Math.floor(size / 2 ** depth) % 2 ? filled[depth]! : zeros[depth]!);

      return out;
    },
    untrack: (index) => void tracked.delete(index),
    toJSON,
    clone: () => incTree(JSON.parse(JSON.stringify(toJSON())) as IncTreeState),
  };
}

/** The root after putting `pair` at leaves `start`, `start + 1` of a tree whose insertion path is `path`. */
export function rootAfterInsert(pair: [bigint, bigint], start: number, path: bigint[]): bigint {
  let node = poseidon([pair[0], pair[1]]);
  const slot = BigInt(start) >> 1n;

  for (let depth = 0; depth < TREE_DEPTH - 1; depth++) {
    node = (slot >> BigInt(depth)) & 1n ? poseidon([path[depth]!, node]) : poseidon([node, path[depth]!]);
  }

  return node;
}

/** The root a leaf at `index` with sibling `path` implies. */
export function rootFromPath(leaf: bigint, index: number, path: bigint[]): bigint {
  let node = leaf;

  for (let depth = 0; depth < TREE_DEPTH; depth++) {
    node = (BigInt(index) >> BigInt(depth)) & 1n ? poseidon([path[depth]!, node]) : poseidon([node, path[depth]!]);
  }

  return node;
}
