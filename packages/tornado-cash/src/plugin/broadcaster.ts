import { Host } from "@kohaku-eth/plugins";
import type { Chain } from 'viem';
import { IRelayerClient, ITornadoWithdrawResponse } from "../relayer/interfaces/relayer-client.interface";
import { RelayerClient } from "../relayer/relayer-client";
import { TCBroadcaster, TCBroadcasterParameters, TCPaymasterBroadcastResponse } from "../v1";
import { IPaymasterConfig, IRelayerWithdrawalPayload, TCPrivateOperation } from "./interfaces/protocol-params.interface";
import { addressToHex } from "../utils";
import { PaymasterBroadcaster } from "../paymaster/paymaster-broadcaster";
import { IGenericPaymasterWithdrawalPayload, IPaymasterBroadcasterClient } from "../relayer/interfaces/paymaster-client.interface";

export interface TCRelayerConstructorParams extends TCBroadcasterParameters {
  host: Host;
  paymasterConfig: Record<number, IPaymasterConfig>;
  chain?: Chain;
  rpcUrl?: string;
}

export class TornadoCashBroadcaster implements TCBroadcaster {
  private relayerClient: IRelayerClient;
  private provider: Host["provider"];
  private paymasterBroadcaster: IPaymasterBroadcasterClient;

  constructor({
    host,
    relayerClientFactory = () => new RelayerClient({ network: host.network }),
    paymasterConfig,
    paymasterClientFactory = () => new PaymasterBroadcaster({ network: host.network })
  }: TCRelayerConstructorParams) {
    this.provider = host.provider;
    this.relayerClient = relayerClientFactory();
    this.paymasterBroadcaster = paymasterClientFactory();
  }

  broadcast(operation: TCPrivateOperation<'paymaster'>): Promise<TCPaymasterBroadcastResponse[]>;
  broadcast(operation: TCPrivateOperation<'relayer'>): Promise<ITornadoWithdrawResponse[]>;
  broadcast(operation: TCPrivateOperation): Promise<(TCPaymasterBroadcastResponse | ITornadoWithdrawResponse)[]>;
  async broadcast({
    withdrawals
  }: TCPrivateOperation): Promise<(TCPaymasterBroadcastResponse | ITornadoWithdrawResponse)[]> {
    const relayerWithdrawals = withdrawals.filter((w) => w.mode === 'relayer');
    const paymasterWithdrawals = withdrawals.filter((w) => w.mode === 'paymaster');

    const [relayerResults, paymasterResults] = await Promise.all([
      this.broadcastViaRelayer(relayerWithdrawals),
      this.broadcastViaPaymaster(paymasterWithdrawals),
    ]);

    return [...relayerResults, ...paymasterResults];
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
    withdrawals: IGenericPaymasterWithdrawalPayload[],
  ): Promise<TCPaymasterBroadcastResponse[]> {
    if (withdrawals.length === 0) return [];

    const results = await this.paymasterBroadcaster.broadcast(withdrawals);

    // Only reachable with a custom paymaster client that breaks its contract.
    if (results.length !== withdrawals.length) {
      throw new Error('Paymaster client did not return one result per withdrawal.');
    }

    return results.map(({ userOpHash, wait }) => ({ id: userOpHash, wait: () => wait() }));
  }
}
