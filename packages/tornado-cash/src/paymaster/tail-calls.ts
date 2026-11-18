import type { TxData } from '@kohaku-eth/provider';
import { isAddress, isHex } from 'viem';

const isCall = (call: unknown): call is TxData => {
  const { to, value, data } = (call ?? {}) as Partial<TxData>;

  return typeof to === 'string' && isAddress(to, { strict: false }) &&
    typeof data === 'string' && isHex(data, { strict: true }) && data.length % 2 === 0 &&
    typeof value === 'bigint' && value >= 0n;
};

/**
 * Calls the caller's `tailCalls` callback once and returns a validated copy of
 * its calls. Every build of the userOp reuses this list, so the signed calls
 * are the ones that were estimated, even if the callback would answer
 * differently, or its returned objects change, later.
 */
export async function resolveTailCalls<Sender>(tailCalls: (sender: Sender) => Promise<TxData[]>, sender: Sender): Promise<TxData[]> {
  const calls: unknown = await tailCalls(sender);

  if (!Array.isArray(calls) || !calls.every(isCall)) {
    throw new Error('tailCalls must resolve to an array of { to: address, value: bigint >= 0, data: hex } calls');
  }

  return calls.map(({ to, value, data }) => ({ to, value, data }));
}
