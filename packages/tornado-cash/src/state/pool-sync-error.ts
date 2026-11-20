import { Address } from '../interfaces/types.interface';
import { addressToHex } from '../utils';

// Provider errors (viem's in particular) put the request URL on later lines, and
// hosted RPC URLs often embed an API key. Keep only the first line, capped, so the
// summary is safe to show in a wallet UI or log.
const MAX_REASON_LENGTH = 200;

function summarizeReason(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const firstLine = message.split('\n', 1)[0]!.trim() || 'unknown error';

  return firstLine.length > MAX_REASON_LENGTH ? `${firstLine.slice(0, MAX_REASON_LENGTH)}…` : firstLine;
}

/** A pool whose configuration or events could not be fetched, with a summary safe to show. */
export interface IPoolSyncFailure {
  pool: Address;
  reason: string;
}

export const poolSyncFailure = (pool: Address, reason: unknown): IPoolSyncFailure => ({
  pool,
  reason: summarizeReason(reason),
});

/**
 * Thrown when one or more pools could not be synced. Pools that did sync keep
 * their progress; the failed ones keep their previous cursor, so the next sync
 * retries exactly the range that failed. Only `name` and `message` survive the
 * worker and Redux boundaries, so the message carries the whole summary.
 */
export class TornadoPoolSyncError extends Error {
  constructor(failures: IPoolSyncFailure[], totalPools: number) {
    const pools = failures.map(({ pool }) => addressToHex(pool)).join(', ');
    const reasons = [...new Set(failures.map(({ reason }) => reason))].join(' | ');

    super(
      `Failed to sync ${failures.length} of ${totalPools} Tornado pools (${pools}): ${reasons}. ` +
      `Balances and notes may be incomplete until a sync succeeds; the next sync retries from each pool's last synced block.`,
    );
    this.name = 'TornadoPoolSyncError';
  }
}
