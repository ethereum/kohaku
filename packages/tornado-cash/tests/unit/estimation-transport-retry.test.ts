import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpRequestError, InternalRpcError, RpcRequestError, TimeoutError } from 'viem';
import { estimateWithTransportRetry, estimationUnavailableReason } from '../../src/paymaster/estimation-retry';

const url = 'https://bundler.invalid';
const body = { method: 'eth_estimateUserOperationGas', params: [] };
const httpError = (status: number, retryAfter?: string) => new HttpRequestError({
  url, status, ...(retryAfter ? { headers: new Headers({ 'Retry-After': retryAfter }) } : {}),
});

describe('estimation availability classification', () => {
  it('recognizes the opaque parser error through viem RPC wrappers', () => {
    const error = new RpcRequestError({ url, body, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } });
    expect(estimationUnavailableReason(new InternalRpcError(error))).toBe('bundler-internal');
  });

  it('rejects even the parser message when it includes revert data', () => {
    const error = new RpcRequestError({ url, body, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.', data: '0x54107e37' } });
    expect(estimationUnavailableReason(new InternalRpcError(error))).toBeUndefined();
  });

  it('recognizes persistent transport failures but not cancellation', () => {
    expect(estimationUnavailableReason(new TimeoutError({ url, body }))).toBe('transport-unavailable');
    expect(estimationUnavailableReason(httpError(429, '60'))).toBe('transport-unavailable');
    expect(estimationUnavailableReason(new DOMException('cancelled', 'AbortError'))).toBeUndefined();
  });
});

describe('read-only estimation transport retries', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([408, 429, 502, 503, 504])('recovers a temporary HTTP %s failure with one retry', async (status) => {
    const result = { preVerificationGas: 281_260n };
    const estimate = vi.fn().mockRejectedValueOnce(httpError(status)).mockResolvedValue(result);
    const pending = estimateWithTransportRetry(estimate);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(result);
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it.each([
    new TimeoutError({ url, body }),
    new Error('wrapped', { cause: new TimeoutError({ url, body }) }),
    new HttpRequestError({ url, cause: Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }) }),
  ])('recovers a recognized timeout or connection reset', async (failure) => {
    const estimate = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(123n);
    const pending = estimateWithTransportRetry(estimate);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(123n);
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it.each([
    new RpcRequestError({ url, body, error: { code: -32500, message: 'AA33 reverted' } }),
    new RpcRequestError({ url, body, error: { code: -32603, message: 'Unknown error, could not parse simulate validation result.' } }),
    new RpcRequestError({ url, body, error: { code: -32500, message: 'preVerificationGas is not enough, required: 281260, got: 100000' } }),
    ...[400, 401, 403, 404, 413, 500].map((status) => httpError(status)),
    new Error('unclassified fetch failed'),
    new DOMException('cancelled', 'AbortError'),
  ])('does not retry a simulation rejection, permanent HTTP failure or unclassified error', async (failure) => {
    const estimate = vi.fn().mockRejectedValue(failure);
    await expect(estimateWithTransportRetry(estimate)).rejects.toBe(failure);
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry an RPC rejection hidden inside a transient-looking HTTP wrapper', async () => {
    const failure = new HttpRequestError({ url, status: 503, cause: new RpcRequestError({ url, body, error: { code: -32500, message: 'invalid proof' } }) });
    const estimate = vi.fn().mockRejectedValue(failure);
    await expect(estimateWithTransportRetry(estimate)).rejects.toBe(failure);
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it('honors a short Retry-After without retrying sooner', async () => {
    const estimate = vi.fn().mockRejectedValueOnce(httpError(429, '2')).mockResolvedValue(123n);
    const pending = estimateWithTransportRetry(estimate);
    await vi.advanceTimersByTimeAsync(1999);
    expect(estimate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(123n);
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it('surfaces a long Retry-After instead of sleeping indefinitely or ignoring it', async () => {
    const failure = httpError(429, '60');
    const estimate = vi.fn().mockRejectedValue(failure);
    await expect(estimateWithTransportRetry(estimate)).rejects.toBe(failure);
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('surfaces the second failure without a third request', async () => {
    const failure = new TimeoutError({ url, body });
    const estimate = vi.fn().mockRejectedValue(failure);
    const pending = expect(estimateWithTransportRetry(estimate)).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await pending;
    expect(estimate).toHaveBeenCalledTimes(2);
  });
});
