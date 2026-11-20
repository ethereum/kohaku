import { type EthereumProvider, type TxLog } from "@kohaku-eth/provider";
import { type Hex } from "../crypto/bytes";
import { sleep } from "../sleep";

/**
 * What to do after a log read over `step` blocks failed: `{ step }` a narrower window (the largest limit the
 * error names below the current one, else a quarter when it speaks of ranges or sizes), `{ busy }` wait and ask
 * again when the node is rate limited, or null when the error is neither.
 */
export function logFailure(error: unknown, step: number): { step: number } | { busy: true } | null {
  const text = error instanceof Error ? `${error.message} ${String((error as { details?: unknown }).details ?? "")}` : String(error);
  const named = [...text.matchAll(/(\d[\d,]*)\s*(?:blocks?|range)\b/gi)]
    .map((m) => Number(m[1]!.replace(/,/g, "")))
    .filter((n) => n > 0 && n < step);

  if (named.length) return { step: Math.max(...named) };

  if (/rate.?limit|too many requests|\b429\b|over rate|capacity/i.test(text)) return { busy: true };

  if (step > 1 && /range|limit|too many|too large|exceed|response size|10000/i.test(text)) return { step: Math.max(1, Math.floor(step / 4)) };

  return null;
}

/**
 * The logs of `address` with `topic0` in blocks `from` to `to`, read in windows of `chunk` blocks that narrow when
 * a node refuses a range. The topic is also checked here, since not every provider applies it.
 */
export async function readLogs(
  provider: EthereumProvider,
  args: { address: Hex; topic0: Hex; from: number; to: number; chunk: number },
): Promise<TxLog[]> {
  const out: TxLog[] = [];
  let step = args.chunk;
  let busy = 0;

  for (let from = args.from; from <= args.to; ) {
    const to = Math.min(args.to, from + step - 1);

    try {
      const logs = await provider.getLogs({
        address: args.address,
        topics: [args.topic0],
        fromBlock: BigInt(from),
        toBlock: BigInt(to),
      });

      for (const log of logs) {
        if (log.topics[0]?.toLowerCase() === args.topic0.toLowerCase() && log.address.toLowerCase() === args.address.toLowerCase()) out.push(log);
      }

      from = to + 1;
      busy = 0;
    } catch (error) {
      const next = logFailure(error, step);

      if (next && "step" in next) {
        step = next.step;
        continue;
      }

      if (next && ++busy <= 6) {
        await sleep(1500 * busy);
        continue;
      }

      throw error;
    }
  }

  return out;
}
