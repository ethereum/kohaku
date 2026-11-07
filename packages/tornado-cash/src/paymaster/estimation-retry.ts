import { HttpRequestError, RpcRequestError, TimeoutError } from 'viem';

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN',
  'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 5_000;

/** Only created around eth_call/eth_estimateGas with state overrides. */
export class RpcSimulationUnsupportedError extends Error {
  constructor(cause: unknown) {
    super('Host RPC does not support withdrawal simulation with state overrides.', { cause });
    this.name = 'RpcSimulationUnsupportedError';
  }
}

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

/** Recognize missing simulation capabilities, never a contract/AA rejection or
 * a generic invalid-params/internal error. Call only for override-bearing RPCs,
 * so an unsupported ordinary read cannot bypass sender/authentication checks. */
export function isRpcSimulationUnsupported(error: unknown): boolean {
  const chain = causeChain(error);
  const details = chain.flatMap(cause => [cause.details, cause.message])
    .filter((value): value is string => typeof value === 'string').join('\n');

  if (/\bAA\d{2}\b|\brevert(?:ed)?\b/i.test(details) ||
      chain.some(cause => cause.data != null && cause.data !== '0x')) return false;

  if (chain.some(cause => cause.code === -32601 || cause.code === -32004)) return true;

  // Some host bridges preserve Error.message but not custom RPC properties.
  return /^method (?:not found|not supported|not available)[.!]?$/im.test(details) ||
    /\beth_(?:call|estimateGas)\b.{0,80}\b(?:not found|not supported|does not exist|not available)\b/i.test(details) ||
    /\bstate[ -]?overrides?\b.{0,80}\b(?:unsupported|not supported|unavailable|disabled)\b|\b(?:unsupported|does not support)\b.{0,80}\bstate[ -]?overrides?\b/i.test(details) ||
    /\btoo many (?:arguments|params|parameters)\b.{0,80}\b(?:2|two)\b/i.test(details);
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
export function estimationUnavailableReason(error: unknown): 'transport-unavailable' | 'bundler-internal' | 'rpc-unsupported' | undefined {
  const chain = causeChain(error);

  if (chain.some(cause => cause instanceof RpcSimulationUnsupportedError)) return 'rpc-unsupported';

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
