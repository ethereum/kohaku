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

  async getQuote({
    asset,
    recipient,
    chainId,
    amount,
    relayerUrl,
    ...body
  }: IQuoteRequest): Promise<IQuoteResponse> {
    const quoteRequest = await this.fetch(`${relayerUrl}/quote`, {
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
    });

    if (!quoteRequest.ok) {
      const body = await quoteRequest.text().catch(() => '');
      const reason = quoteErrorMessage(body).trim().slice(0, 512);

      throw new RelayerError(`Quote request failed (HTTP ${quoteRequest.status})${reason ? `: ${reason}` : ''}`);
    }

    return quoteRequest.json();
  }

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
    const relayRequest = await this.fetch(`${relayerUrl}/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(relayBody),
    });

    const response = (await relayRequest.json()) as IRelayResponse;

    if (!response.success) {
        throw new RelayerError(response.error);
    }

    return response;
  }

  async getFees({ assetAddress, chainId, relayerUrl }: IRelayFeesRequest): Promise<IRelayerFeeResponse> {
    const feesUrl = new URL(`${relayerUrl}/details`);

    feesUrl.searchParams.append('assetAddress', toHex(assetAddress));
    feesUrl.searchParams.append('chainId', chainId.toString(10));

    const feesResponse = await this.fetch(feesUrl);

    return feesResponse.json();
  }
}
