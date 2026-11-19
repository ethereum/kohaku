import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelayerClient } from '../../src/relayer/relayer-client';

const quoteRequest = { asset: 1n, recipient: 2n, chainId: 1n, amount: 100n, relayerUrl: 'https://relayer.test' };
const relayRequest = {
  chainId: 1n, scope: 1n, relayerUrl: quoteRequest.relayerUrl,
  withdrawal: { processooor: '0x0000000000000000000000000000000000000001' as const, data: '0x' as const },
  proof: { pi_a: [], pi_b: [], pi_c: [] }, publicSignals: [],
};
const acknowledgement = { success: true, requestId: 'request-1', timestamp: 1, txHash: `0x${'ab'.repeat(32)}` };

afterEach(() => vi.useRealTimers());

describe('RelayerClient response safety', () => {
  it('requires a valid acknowledgement and successful HTTP status', async () => {
    const client = (body: unknown, status = 200) => new RelayerClient({ network: { fetch: async () => Response.json(body, { status }) } });

    await expect(client(acknowledgement).relay(relayRequest)).resolves.toEqual(acknowledgement);

    for (const body of [null, { ...acknowledgement, success: 'true' }, { ...acknowledgement, txHash: '0x00' },
      { ...acknowledgement, requestId: '' }, { ...acknowledgement, timestamp: '1' }]) {
      await expect(client(body).relay(relayRequest)).rejects.toThrow('Invalid relayer acknowledgement');
    }

    await expect(client(acknowledgement, 503).relay(relayRequest)).rejects.toThrow('HTTP 503');
    await expect(client({ success: false, error: 'Rejected' }).relay(relayRequest)).rejects.toThrow('Rejected');
  });

  it('times out stalled fetches and bodies and cancels their work', async () => {
    vi.useFakeTimers();

    for (const stalledBody of [false, true]) {
      let signal: AbortSignal | null | undefined;
      const cancel = vi.fn();
      const client = new RelayerClient({ network: { fetch: async (_url, init) => {
        signal = init?.signal;

        return stalledBody ? new Response(new ReadableStream({ cancel })) : new Promise<Response>(() => {});
      } } });
      const settled = expect(client.getQuote(quoteRequest)).rejects.toThrow('did not answer within 30000ms');

      await vi.advanceTimersByTimeAsync(30_000);
      await settled;

      expect(signal?.aborted).toBe(true);

      if (stalledBody) expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it('rejects oversized bodies before parsing, with or without Content-Length', async () => {
    for (const status of [200, 503]) {
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(64 * 1024 + 1)); },
        cancel,
      }), { status });
      const client = new RelayerClient({ network: { fetch: async () => response } });

      await expect(client.getQuote(quoteRequest)).rejects.toThrow('exceeds 64 KiB');
      expect(cancel).toHaveBeenCalledOnce();
    }

    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-length': '65537' } });
    const client = new RelayerClient({ network: { fetch: async () => response } });

    await expect(client.getQuote(quoteRequest)).rejects.toThrow('exceeds 64 KiB');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
