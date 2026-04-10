import { Host } from "@kohaku-eth/plugins";
import { IRelayerClient, ITornadoWithdrawResponse } from "../relayer/interfaces/relayer-client.interface";
import { RelayerClient } from "../relayer/relayer-client";
import { TCBroadcaster, TCBroadcasterParameters } from "../v1";
import { TCPrivateOperation } from "./interfaces/protocol-params.interface";
import { addressToHex } from "../utils";

export interface TCRelayerConstructorParams extends TCBroadcasterParameters {
  relayerClientFactory?: () => IRelayerClient;
  host: Host;
}

export class TornadoCashBroadcaster implements TCBroadcaster {
  private relayerClient: IRelayerClient;

  constructor({
    host, relayerClientFactory = () => new RelayerClient({ network: host.network }),
  }: TCRelayerConstructorParams) {
    this.relayerClient = relayerClientFactory();
  }

  async broadcast({
    withdrawals
  }: TCPrivateOperation): Promise<ITornadoWithdrawResponse[]> {
    const withdrawalsResults = await Promise.allSettled(withdrawals.map(async ({ proof: { args, proof }, poolAddress, relayerUrl }) => {
      return this.relayerClient.withdraw(relayerUrl, {
        proof,
        args,
        contract: addressToHex(poolAddress)
      })
    }));
    
    const failedWithdrawals = withdrawalsResults.filter((w) => w.status === 'rejected');

    if (failedWithdrawals.length > 0) {
      console.warn(`Some withdrawals failed.`, failedWithdrawals.map((e) => e.reason).join('\n'))
    }

    return withdrawalsResults.filter((w) => w.status === 'fulfilled').map((w) => w.value);
  }
}
