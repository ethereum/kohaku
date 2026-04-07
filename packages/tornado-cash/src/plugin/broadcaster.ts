import { Host } from "@kohaku-eth/plugins";
import { IRelayerClient, ITornadoWithdrawResponse } from "../relayer/interfaces/relayer-client.interface";
import { RelayerClient } from "../relayer/relayer-client";
import { PPv1Broadcaster, PPv1BroadcasterParameters } from "../v1";
import { PPv1PrivateOperation } from "./interfaces/protocol-params.interface";
import { addressToHex } from "../utils";

export interface PPv1RelayerConstructorParams extends PPv1BroadcasterParameters {
  relayerClientFactory?: () => IRelayerClient;
  host: Host;
}

export class PrivacyPoolsBroadcaster implements PPv1Broadcaster {
  private relayerClient: IRelayerClient;

  constructor({
    host, relayerClientFactory = () => new RelayerClient({ network: host.network }),
  }: PPv1RelayerConstructorParams) {
    this.relayerClient = relayerClientFactory();
  }

  async broadcast({
    withdrawals
  }: PPv1PrivateOperation): Promise<ITornadoWithdrawResponse[]> {
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
