export type WaitForTransactionOptions = {
    /** Delay between completed receipt polls. */
    pollIntervalMs: number;
    /** Total wait budget, including time spent awaiting a receipt request. */
    timeoutMs: number;
};

export const DEFAULT_WAIT_FOR_TRANSACTION: Readonly<WaitForTransactionOptions> = {
    pollIntervalMs: 100,
    timeoutMs: 10_000,
};

export const resolveWaitForTransactionOptions = (
    options: Partial<WaitForTransactionOptions> = {},
): WaitForTransactionOptions => {
    const resolved = {
        pollIntervalMs: options.pollIntervalMs ?? DEFAULT_WAIT_FOR_TRANSACTION.pollIntervalMs,
        timeoutMs: options.timeoutMs ?? DEFAULT_WAIT_FOR_TRANSACTION.timeoutMs,
    };

    for (const [name, value] of Object.entries(resolved)) {
        if (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647) {
            throw new RangeError(`${name} must be an integer between 1 and 2147483647 milliseconds`);
        }
    }

    return resolved;
};

/**
 * Bounds the whole wait, including an unresolved RPC request. A provider's
 * in-flight request cannot be cancelled here, but no further polls start
 * after the wait settles, and all timers owned by this helper are cleared.
 */
export const waitForReceipt = async (
    txHash: string,
    getReceipt: () => Promise<unknown>,
    options: WaitForTransactionOptions,
): Promise<void> => {
    const started = performance.now();
    const timeoutError = () => new Error(`Timed out waiting for transaction: ${txHash}`);
    let stopped = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
            stopped = true;
            reject(timeoutError());
        }, options.timeoutMs);
    });

    const poll = async (): Promise<void> => {
        while (!stopped) {
            const receipt = await getReceipt();

            if (stopped) return;

            // A completed request can resume before an already-due timeout callback.
            if (performance.now() - started >= options.timeoutMs) throw timeoutError();

            if (receipt) return;

            await new Promise<void>((resolve) => {
                pollTimer = setTimeout(resolve, options.pollIntervalMs);
            });
        }
    };

    try {
        await Promise.race([poll(), timeout]);
    } finally {
        stopped = true;
        clearTimeout(timeoutTimer);
        clearTimeout(pollTimer);
    }
};
