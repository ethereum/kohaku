export interface IBaseRelayerRequest {
  relayerUrl: string;
}

export interface IRelayerStatusResponse {
  currentQueue: number;
  netId: number;
  rewardAccount: string;
  version: string;
  tornadoServiceFee: number;
  ethPrices: Record<string, string>;
}

export interface ITornadoWithdrawRequest {
  proof: `0x${string}`;
  args: [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`];
  contract: `0x${string}`;
}

export interface ITornadoWithdrawResponse {
  id: string;
}

export interface IRelayerClient {
  getStatus(hostname: string): Promise<IRelayerStatusResponse>;
  withdraw(relayerUrl: string, body: ITornadoWithdrawRequest): Promise<ITornadoWithdrawResponse>;
}
