import { Host } from "@kohaku-eth/plugins";
import type { Chain } from 'viem';
import { IRelayerClient, ITornadoWithdrawResponse } from "../relayer/interfaces/relayer-client.interface";
import { RelayerClient } from "../relayer/relayer-client";
import { TCBroadcaster, TCBroadcasterParameters } from "../v1";
import { IPaymasterWithdrawalPayload, IRelayerWithdrawalPayload, TCPrivateOperation } from "./interfaces/protocol-params.interface";
import { addressToHex } from "../utils";
import { PaymasterBroadcaster, PaymasterBroadcastResult } from "../paymaster/paymaster-broadcaster";

export interface TCRelayerConstructorParams extends TCBroadcasterParameters {
  host: Host;
  chain?: Chain;
  rpcUrl?: string;
}

export type TCBroadcastResult = ITornadoWithdrawResponse[] | PaymasterBroadcastResult[];

export class TornadoCashBroadcaster implements TCBroadcaster {
  private relayerClient: IRelayerClient;
  private provider: Host["provider"];

  constructor({
    host,
    relayerClientFactory = () => new RelayerClient({ network: host.network }),
  }: TCRelayerConstructorParams) {
    this.provider = host.provider;
    this.relayerClient = relayerClientFactory();
  }

  async broadcast({
    withdrawals
  }: TCPrivateOperation): Promise<ITornadoWithdrawResponse[]> {
    const relayerWithdrawals = withdrawals.filter((w) => w.mode === 'relayer');
    const paymasterWithdrawals = withdrawals.filter((w) => w.mode === 'paymaster') as IPaymasterWithdrawalPayload[];

    const [relayerResults, paymasterResults] = await Promise.all([
      this.broadcastViaRelayer(relayerWithdrawals),
      paymasterWithdrawals.length > 0
        ? this.broadcastViaPaymaster(paymasterWithdrawals)
        : Promise.resolve([]),
    ]);

    // Normalize paymaster results into the same shape as relayer responses
    const normalizedPaymasterResults: ITornadoWithdrawResponse[] = paymasterResults.map(
      ({ userOpHash }) => ({ id: userOpHash }),
    );

    return [...relayerResults, ...normalizedPaymasterResults];
  }

  private async broadcastViaRelayer(
    withdrawals: IRelayerWithdrawalPayload[],
  ): Promise<ITornadoWithdrawResponse[]> {
    if (withdrawals.length === 0) return [];

    const successes: ITornadoWithdrawResponse[] = [];
    const failures: Error[] = []

    for (const { proof: { args, proof }, poolAddress, relayerUrl } of withdrawals) {

      try {
        successes.push(await this.relayerClient.withdraw(relayerUrl, {
          proof,
          args,
          contract: addressToHex(poolAddress)
        }));
      } catch (error) {
        failures.push(error as Error);
      }

    }

    if (failures.length > 0) {
      console.warn(`Some withdrawals failed.`, failures.map((e) => e.message).join('\n'))
    }

    return successes;
  }

  private async broadcastViaPaymaster(
    withdrawals: IPaymasterWithdrawalPayload[],
  ): Promise<PaymasterBroadcastResult[]> {

    const broadcaster = new PaymasterBroadcaster(this.provider);

    return broadcaster.broadcast(withdrawals);
  }
}
