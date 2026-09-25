export type WaitForTransactionOptions = {
    /** Delay between two receipt polls. */
    pollIntervalMs: number;
    /** Wall-clock budget for the whole wait, including the time spent inside each poll. */
    timeoutMs: number;
};

/**
 * Over an anonymization network every receipt poll is a full round trip
 * (~2s through Tor), so the defaults must be sized against block time rather
 * than against a local RPC. 4s between polls, 5 minutes total.
 */
export const DEFAULT_WAIT_FOR_TRANSACTION: WaitForTransactionOptions = {
    pollIntervalMs: 4_000,
    timeoutMs: 300_000,
};

/**
 * Polls `getReceipt` until it returns a non-null value or `timeoutMs` elapses.
 * Kept free of any browser dependency so it can be unit-tested in Node.
 */
export const waitForReceipt = async (
    txHash: string,
    getReceipt: () => Promise<unknown>,
    options: WaitForTransactionOptions,
): Promise<void> => {
    const start = Date.now();

    while (true) {
        const receipt = await getReceipt();

        if (receipt) return;

        if (Date.now() - start > options.timeoutMs) {
            throw new Error(`anon-rpc: timed out waiting for transaction ${txHash} after ${options.timeoutMs}ms`);
        }

        await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
    }
};
