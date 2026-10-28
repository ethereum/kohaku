import { HttpRequestError, RpcRequestError, TimeoutError } from 'viem';

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN',
  'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 5_000;

type ErrorCause = { cause?: unknown; code?: unknown; details?: unknown; message?: unknown; data?: unknown };

function causeChain(error: unknown): ErrorCause[] {
  const chain: ErrorCause[] = [];
  const seen = new Set<object>();
  let current = error;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = (current as ErrorCause).cause;
  }

  return chain;
}

/** Return a delay only for recognized transport failures, never RPC rejections. */
function retryDelay(error: unknown): number | undefined {
  const chain = causeChain(error);

  // Even an HTTP-looking wrapper must not turn a contract revert, insufficient
  // gas response or generic JSON-RPC internal error into a transport retry.
  if (chain.some((cause) => cause instanceof RpcRequestError ||
      (typeof cause.code === 'number' && cause.code < 0))) return undefined;

  for (const cause of chain) {
    if (cause instanceof HttpRequestError && cause.status !== undefined) {
      if (!RETRYABLE_HTTP_STATUSES.has(cause.status)) return undefined;

      const retryAfter = cause.headers?.get('retry-after');

      if (retryAfter) {
        const seconds = Number(retryAfter);
        const delay = Number.isFinite(seconds)
          ? seconds * 1_000 : Date.parse(retryAfter) - Date.now();

        // Do not retry sooner than the server allows, or make callers wait
        // indefinitely during preparation. Surface long rate limits instead.
        if (delay > MAX_RETRY_DELAY_MS) return undefined;

        if (Number.isFinite(delay) && delay > 0) return Math.max(DEFAULT_RETRY_DELAY_MS, delay);
      }

      return DEFAULT_RETRY_DELAY_MS;
    }
  }

  if (chain.some((cause) => cause instanceof TimeoutError ||
      (typeof cause.code === 'string' && RETRYABLE_NETWORK_CODES.has(cause.code)))) {
    return DEFAULT_RETRY_DELAY_MS;
  }

  return undefined;
}

/**
 * One bounded retry for read-only gas estimation. The callback must reuse the
 * exact signed operation. Never apply this to eth_sendUserOperation.
 */
export async function estimateWithTransportRetry<T>(estimate: () => Promise<T>): Promise<T> {
  try {
    return await estimate();
  } catch (error) {
    const delay = retryDelay(error);

    if (delay === undefined) throw error;

    await new Promise((resolve) => setTimeout(resolve, delay));

    return estimate();
  }
}

/** Classify availability failures separately from known-invalid operations. */
export function estimationUnavailableReason(error: unknown): 'transport-unavailable' | 'bundler-internal' | undefined {
  const chain = causeChain(error);
  const rpc = chain.filter((cause) => cause instanceof RpcRequestError ||
    (typeof cause.code === 'number' && cause.code < 0));

  if (rpc.length) {
    // This specific opaque estimator failure has been observed on otherwise
    // executable batches. Never treat AAxx reverts or supplied revert data as it.
    const opaque = rpc.every((cause) => cause.code === -32603 && cause.data == null &&
      /^Unknown error, could not parse simulate validation result\.?$/i.test(String(cause.details ?? cause.message)));

    return opaque ? 'bundler-internal' : undefined;
  }

  const http = chain.find((cause) => cause instanceof HttpRequestError && cause.status !== undefined) as HttpRequestError | undefined;

  if (http) return RETRYABLE_HTTP_STATUSES.has(http.status!) ? 'transport-unavailable' : undefined;

  if (chain.some((cause) => cause instanceof TimeoutError ||
      (typeof cause.code === 'string' && RETRYABLE_NETWORK_CODES.has(cause.code)))) return 'transport-unavailable';

  return undefined;
}
