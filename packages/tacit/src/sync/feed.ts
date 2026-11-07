import { type TacitChainConfig } from "../config";
import { unhex } from "../crypto/bytes";
import { type TransactEvent } from "../pool/abi";
import { type TacitRelayerClient } from "../relayer/client";

export const byPosition = (a: TransactEvent, b: TransactEvent) => a.block - b.block || a.firstIndex - b.firstIndex;

/**
 * One page of confirmed history from the relayer's feed, blocks `from` to `safe` at most: the events in chain order
 * and the block they run through, or null when the feed has nothing new. It is only a source: the caller checks the
 * tree it builds against the pool before keeping any of it.
 */
export async function feedEvents(
  relayer: TacitRelayerClient,
  config: TacitChainConfig,
  from: number,
  safe: number,
): Promise<{ events: TransactEvent[]; through: number } | null> {
  const feed = await relayer.events(from);

  if (Number(feed.chainId) !== config.chainId || String(feed.pool).toLowerCase() !== config.pool.toLowerCase()) {
    throw new Error("tacit: the feed is for another pool");
  }

  const through = Math.min(Number(feed.through), safe);

  if (through < from) return null;

  const events = feed.events
    .filter((e) => e.kind === "transact" && e.block >= from && e.block <= through)
    .map((e) => ({
      nf: [BigInt(e.nf0), BigInt(e.nf1)] as [bigint, bigint],
      outLeaf: [BigInt(e.outLeaf0), BigInt(e.outLeaf1)] as [bigint, bigint],
      firstIndex: Number(e.firstIndex),
      memo: [unhex(e.memo0), unhex(e.memo1)] as [Uint8Array, Uint8Array],
      block: e.block,
    }))
    .sort(byPosition);

  return { events, through };
}
