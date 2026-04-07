import { Network } from "@kohaku-eth/plugins";
import {
  IRelayerClient,
  IRelayerStatusResponse,
  ITornadoWithdrawRequest,
  ITornadoWithdrawResponse,
} from "./interfaces/relayer-client.interface";

export interface IRelayerClientParams {
  network: Network;
}

export class RelayerError extends Error {}

export class RelayerClient implements IRelayerClient {
  private fetch: Network["fetch"];

  constructor({ network: { fetch } }: IRelayerClientParams) {
    this.fetch = fetch;
  }

  async getStatus(hostname: string): Promise<IRelayerStatusResponse> {
    const statusResponse = await this.fetch(`https://${hostname}/status`);

    return statusResponse.json();
  }

  async withdraw(relayerUrl: string, body: ITornadoWithdrawRequest): Promise<ITornadoWithdrawResponse> {
    const response = await this.fetch(`${relayerUrl}v1/tornadoWithdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const { error } = await response.json();
      throw new RelayerError(error);
    }

    return response.json();
  }
}
