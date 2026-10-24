import { type IncTree } from "../pool/tree";
import { type TacitRelayerClient } from "../relayer/client";
import { type PoolSync } from "../sync/pool-sync";
import { type TacitMode } from "./types";

/**
 * The tree a relayed spend is proven against: this wallet's, plus the insertions the relayer has queued after the
 * pool's head, checked to reach the tail the relayer announces. Otherwise this wallet's own. A spend that inserts
 * nothing (a withdrawal with no change) proves membership against a root the pool has held, so it never follows the queue.
 */
export async function provingTree(args: { sync: PoolSync; relayer?: TacitRelayerClient; mode: TacitMode; inserts: boolean }): Promise<IncTree> {
  if (args.mode === "self" || !args.relayer || !args.inserts) return args.sync.tree;

  try {
    const head = await args.relayer.head();

    // The pool may have moved since the last read: read once more before comparing.
    if (BigInt(head.root) !== args.sync.tree.root) await args.sync.sync();

    const own = args.sync.tree;

    if (BigInt(head.root) !== own.root) return own;

    const queued = own.clone();

    queued.append(head.pending.flatMap((x) => [BigInt(x.outLeaf0), BigInt(x.outLeaf1)]));

    return queued.root === BigInt(head.tail.root) ? queued : own;
  } catch {
    return args.sync.tree;
  }
}
