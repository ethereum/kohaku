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

const DNS_HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const LOCAL_HOSTNAME = /(?:^|\.)(?:localhost|local|internal)$|(?:^|\.)home\.arpa$/i;

function relayerEndpoint(hostname: string, path: string): string {
  // Validate at fetch time so saved state and prepared operations get the same checks.
  if (
    typeof hostname !== 'string' || hostname.length > 253 ||
    DNS_HOSTNAME.exec(hostname)?.[0] !== hostname || LOCAL_HOSTNAME.test(hostname)
  ) {
    throw new RelayerError('Relayer must use a DNS hostname without credentials, port or URL components.');
  }

  return new URL(path, `https://${hostname}/`).href;
}

export class RelayerClient implements IRelayerClient {
  private fetch: Network["fetch"];

  constructor({ network: { fetch } }: IRelayerClientParams) {
    this.fetch = fetch;
  }

  async getStatus(hostname: string): Promise<IRelayerStatusResponse> {
    const statusResponse = await this.fetch(relayerEndpoint(hostname, 'status'), { redirect: 'error' });

    return statusResponse.json();
  }

  async withdraw(relayerUrl: string, body: ITornadoWithdrawRequest): Promise<ITornadoWithdrawResponse> {
    const origin = typeof relayerUrl === 'string' && relayerUrl.length <= 262
      ? /^https:\/\/([^/]+)\/?$/i.exec(relayerUrl) : null;

    if (!origin || origin[0] !== relayerUrl) throw new RelayerError('Relayer URL must be an HTTPS origin.');

    const response = await this.fetch(relayerEndpoint(origin[1]!, 'v1/tornadoWithdraw'), {
      method: 'POST',
      redirect: 'error',
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
