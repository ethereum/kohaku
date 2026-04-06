import { Network } from "@kohaku-eth/plugins";
import {
  IQuoteRequest,
  IQuoteResponse,
  IRelayerClient,
  IRelayerFeeResponse,
  IRelayerStatusResponse,
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
            amount: toHex(amount),
            ...body,
        })
    })

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

  async getStatus(hostname: string): Promise<IRelayerStatusResponse> {
    const statusResponse = await this.fetch(`https://${hostname}/status`);

    return statusResponse.json();
  }
}
