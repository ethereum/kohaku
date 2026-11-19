import { Network } from "@kohaku-eth/plugins";
import {
  IQuoteRequest,
  IQuoteResponse,
  IRelayerClient,
  IRelayerFeeResponse,
  IRelayFeesRequest,
  IRelayRequest,
  IRelayRequestBody,
  IRelayResponse,
  ISuccessfullRelayResponse,
} from "./interfaces/relayer-client.interface";
import { toHex } from "viem";
import { addressToHex } from "../utils";
import { withTimeout } from "../state/utils/async.utils";

const MAX_RESPONSE_BYTES = 64 * 1024;

async function readResponse(response: Response, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new RelayerError('Relayer response exceeds 64 KiB');
  }

  const reader = response.body?.getReader();

  if (!reader) return '';

  const cancel = () => { void reader.cancel().catch(() => {}); };
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';

  signal.addEventListener('abort', cancel, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) return body + decoder.decode();

      size += value.byteLength;

      if (size > MAX_RESPONSE_BYTES) throw new RelayerError('Relayer response exceeds 64 KiB');

      body += decoder.decode(value, { stream: true });
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

export interface IRelayerClientParams {
  network: Network;
}

export class RelayerError extends Error {}

function quoteErrorMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);

    if (typeof parsed === 'string') return parsed;

    if (parsed && typeof parsed === 'object') {
      const { error, message } = parsed as { error?: unknown; message?: unknown };

      if (typeof error === 'string') return error;

      if (typeof message === 'string') return message;

      if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
    }
  } catch { /* Non-JSON error responses are reported as text. */ }

  return body;
}

export class RelayerClient implements IRelayerClient {
  private fetch: Network["fetch"];

  constructor({ network: { fetch } }: IRelayerClientParams) {
    this.fetch = fetch;
  }

  private request<T>(url: string | URL, init: RequestInit, label: string, timeoutMs = 30_000): Promise<T> {
    return withTimeout(timeoutMs, label, async signal => {
      const response = await this.fetch(url, { ...init, signal });

      if (signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw signal.reason;
      }

      const body = await readResponse(response, signal);

      if (!response.ok) {
        const reason = quoteErrorMessage(body).trim().slice(0, 512);

        throw new RelayerError(`${label} failed (HTTP ${response.status})${reason ? `: ${reason}` : ''}`);
      }

      return JSON.parse(body) as T;
    });
  }

  async getQuote({
    asset,
    recipient,
    chainId,
    amount,
    relayerUrl,
    ...body
  }: IQuoteRequest): Promise<IQuoteResponse> {
    return this.request(`${relayerUrl}/quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            asset: addressToHex(asset),
            recipient: addressToHex(recipient),
            chainId: toHex(chainId),
            amount: amount.toString(10),
            ...body,
        })
    }, 'Quote request');
  }

  /** Acknowledgement only: a timeout does not mean the withdrawal was not submitted. */
  async relay({
    chainId,
    scope,
    relayerUrl,
    ...params
  }: IRelayRequest): Promise<ISuccessfullRelayResponse> {
    const relayBody: IRelayRequestBody = {
        ...params,
        chainId: toHex(chainId),
        scope: toHex(scope),
    }
    const response = await this.request<IRelayResponse>(`${relayerUrl}/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(relayBody),
    }, 'Relay request', 180_000);

    if (response?.success === false && typeof response.error === 'string') {
        throw new RelayerError(response.error);
    }

    if (response?.success !== true || typeof response.requestId !== 'string' || !response.requestId.trim() ||
        !Number.isFinite(response.timestamp) || typeof response.txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(response.txHash)) {
      throw new RelayerError('Invalid relayer acknowledgement');
    }

    return response;
  }

  async getFees({ assetAddress, chainId, relayerUrl }: IRelayFeesRequest): Promise<IRelayerFeeResponse> {
    const feesUrl = new URL(`${relayerUrl}/details`);

    feesUrl.searchParams.append('assetAddress', toHex(assetAddress));
    feesUrl.searchParams.append('chainId', chainId.toString(10));

    return this.request(feesUrl, {}, 'Fee request');
  }
}
