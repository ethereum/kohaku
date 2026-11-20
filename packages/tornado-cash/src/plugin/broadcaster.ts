import { Host } from "@kohaku-eth/plugins";
import type { Chain } from 'viem';
import { IRelayerClient, ITornadoWithdrawResponse } from "../relayer/interfaces/relayer-client.interface";
import { RelayerClient } from "../relayer/relayer-client";
import { TCBroadcaster, TCBroadcasterParameters, TCPaymasterBroadcastResponse } from "../v1";
import { IPaymasterConfig, IRelayerWithdrawalPayload, TCPrivateOperation } from "./interfaces/protocol-params.interface";
import { addressToHex } from "../utils";
import { PaymasterBroadcaster } from "../paymaster/paymaster-broadcaster";
import { rethrowWithStaleNonces } from "../paymaster/sender-nonces";
import { IGenericPaymasterWithdrawalPayload, IPaymasterBroadcasterClient } from "../relayer/interfaces/paymaster-client.interface";

export interface TCRelayerConstructorParams extends TCBroadcasterParameters {
  host: Host;
  paymasterConfig: Record<number, IPaymasterConfig>;
  chain?: Chain;
  rpcUrl?: string;
}

export type TCBroadcastResponse = TCPaymasterBroadcastResponse | ITornadoWithdrawResponse;

const MAX_REASON_LENGTH = 200;

const describeReason = (reason: unknown): string => {
  const message = reason instanceof Error ? reason.message : 'Unknown error.';

  return message.length > MAX_REASON_LENGTH ? `${message.slice(0, MAX_REASON_LENGTH)}…` : message;
};

/**
 * Some withdrawals of a broadcast failed. `results` has one entry per
 * withdrawal, in input order: the others were sent, and their responses are
 * there. Its message is safe to report; each reason is bounded.
 */
export class TornadoBroadcastError extends Error {
  constructor(readonly results: PromiseSettledResult<TCBroadcastResponse>[]) {
    const failures = results.flatMap((result, index) => result.status === 'rejected' ? [`#${index}: ${describeReason(result.reason)}`] : []);

    super(`${failures.length} of ${results.length} withdrawals failed to broadcast; the others were sent. ${failures.join('; ')}`);
    this.name = 'TornadoBroadcastError';
  }
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
  broadcast(operation: TCPrivateOperation): Promise<TCBroadcastResponse[]>;
  async broadcast({
    withdrawals
  }: TCPrivateOperation): Promise<TCBroadcastResponse[]> {
    // Each withdrawal is broadcast and settled on its own, in input order, so a
    // failure neither hides the other outcomes nor shifts results off their inputs.
    const results: PromiseSettledResult<TCBroadcastResponse>[] = [];

    for (const withdrawal of withdrawals) {
      try {
        const value = withdrawal.mode === 'relayer'
          ? await this.broadcastViaRelayer(withdrawal)
          : await this.broadcastViaPaymaster(withdrawal);

        results.push({ status: 'fulfilled', value });
      } catch (reason) {
        results.push({ status: 'rejected', reason });
      }
    }

    const [onlyResult] = results;

    // A single withdrawal has no partial outcome to report, so it keeps its own
    // error (e.g. `PaymasterBroadcastError`, as every paymaster operation has one).
    // A client may throw a non-Error; that is reported as a `TornadoBroadcastError`.
    if (results.length === 1 && onlyResult!.status === 'rejected' && onlyResult!.reason instanceof Error) {
      throw onlyResult!.reason;
    }

    if (results.some(({ status }) => status === 'rejected')) throw new TornadoBroadcastError(results);

    return results.map((result) => (result as PromiseFulfilledResult<TCBroadcastResponse>).value);
  }

  private broadcastViaRelayer(
    { proof: { args, proof }, poolAddress, relayerUrl }: IRelayerWithdrawalPayload,
  ): Promise<ITornadoWithdrawResponse> {
    return this.relayerClient.withdraw(relayerUrl, {
      proof,
      args,
      contract: addressToHex(poolAddress)
    });
  }

  private async broadcastViaPaymaster(
    withdrawal: IGenericPaymasterWithdrawalPayload,
  ): Promise<TCPaymasterBroadcastResponse> {
    const [result] = await this.paymasterBroadcaster.broadcast([withdrawal])
      .catch((error: unknown) => rethrowWithStaleNonces(this.provider, withdrawal, error));

    // Only reachable with a custom paymaster client that breaks its contract.
    if (!result) throw new Error('Paymaster client returned no result for the withdrawal.');

    return { id: result.userOpHash, wait: () => result.wait() };
  }
}
