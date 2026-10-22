import type { WaitForTransactionOptions } from '../raw/wait';

export type { WaitForTransactionOptions } from '../raw/wait';

/**
 * Over an anonymization network every receipt poll is a full round trip
 * (~2s through Tor), so the defaults must be sized against block time rather
 * than against a local RPC. 4s between polls, 5 minutes total.
 */
export const DEFAULT_WAIT_FOR_TRANSACTION: Readonly<WaitForTransactionOptions> = {
    pollIntervalMs: 4_000,
    timeoutMs: 300_000,
};
