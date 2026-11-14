import { type PoolKeys } from "../crypto/address";
import { hex, unhex, type Hex } from "../crypto/bytes";
import { nullifierOf, ownedKeys } from "../crypto/keys";
import { type TransactEvent } from "../pool/abi";
import { openNote } from "../pool/memo";
import { incTree, type IncTree, type IncTreeState } from "../pool/tree";

/** A note of this wallet as it is saved: view-level only. Spend keys are derived again when needed. */
export type StoredNote = { index: number; leaf: string; v: string; rho: string; secret: Hex; block: number };

/** A stored note with the keys to spend it. */
export type OwnedNote = StoredNote & { sk: bigint; nk: bigint; nf: bigint };

export type SavedState = { block: number; tree: IncTreeState; notes: StoredNote[] };

/** Everything read from the pool through `block`, with the paths of this wallet's unspent notes. */
export type SyncState = { block: number; tree: IncTree; notes: OwnedNote[] };

/** The events do not continue the tree: a gap, or a reordering, in the history read. */
export class OutOfOrderError extends Error {}

export function withKeys(note: StoredNote, keys: PoolKeys): OwnedNote {
  const owned = ownedKeys(keys.zk, unhex(note.secret));

  return { ...note, sk: owned.sk, nk: owned.nk, nf: nullifierOf(owned.nk, BigInt(note.leaf), note.index) };
}

export function stateFromSaved(saved: SavedState | null, keys: PoolKeys, deployBlock: number): SyncState {
  if (!saved) return { block: deployBlock - 1, tree: incTree(), notes: [] };

  return { block: saved.block, tree: incTree(saved.tree), notes: saved.notes.map((note) => withKeys(note, keys)) };
}

export function toSaved(state: SyncState): SavedState {
  return {
    block: state.block,
    tree: state.tree.toJSON(),
    notes: state.notes.map(({ index, leaf, v, rho, secret, block }) => ({ index, leaf, v, rho, secret, block })),
  };
}

/**
 * `events` (in chain order) appended to a copy of `state`: their leaves go into the tree, the memos that open for
 * `keys` become tracked notes, and notes whose nullifier appears are dropped with their paths. The state of the
 * pool is rebuilt from the events alone, so a gap or a reordering is an error, not something to guess around.
 */
export function absorb(state: SyncState, events: TransactEvent[], ctx: { keys: PoolKeys; asset: bigint }): SyncState {
  const tree = state.tree.clone();
  const notes = new Map(state.notes.map((note) => [note.index, note]));
  const spent = new Set<bigint>();
  const batch: bigint[] = [];
  const track: number[] = [];

  for (const event of events) {
    for (const nf of event.nf) if (nf !== 0n) spent.add(nf);

    if (event.outLeaf[0] === 0n && event.outLeaf[1] === 0n) continue;

    if (event.firstIndex !== tree.size + batch.length) {
      const have = tree.size + batch.length;

      throw new OutOfOrderError(`tacit: leaf ${event.firstIndex} out of order (have ${have}); call rescan() to rebuild the history`);
    }

    for (const k of [0, 1] as const) {
      const leaf = event.outLeaf[k];
      const memo = event.memo[k];

      if (leaf === 0n || !memo.length) continue;

      const opened = openNote(ctx.keys, { memo, leaf, asset: ctx.asset });

      if (!opened || opened.value === 0n) continue;

      const index = event.firstIndex + k;
      const stored: StoredNote = {
        index,
        leaf: leaf.toString(),
        v: opened.value.toString(),
        rho: opened.rho.toString(),
        secret: hex(opened.secret),
        block: event.block,
      };

      track.push(index);
      notes.set(index, withKeys(stored, ctx.keys));
    }

    batch.push(event.outLeaf[0], event.outLeaf[1]);
  }

  tree.append(batch, track);

  for (const [index, note] of notes) {
    if (!spent.has(note.nf)) continue;

    tree.untrack(index);
    notes.delete(index);
  }

  return { block: state.block, tree, notes: [...notes.values()].sort((a, b) => a.index - b.index) };
}
