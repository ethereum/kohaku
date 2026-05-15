import { Host } from "@kohaku-eth/plugins";
import { IRelayerClient, ITornadoWithdrawResponse } from "../relayer/interfaces/relayer-client.interface";
import { RelayerClient } from "../relayer/relayer-client";
import { TCBroadcaster, TCBroadcasterParameters } from "../v1";
import { TCPrivateOperation } from "./interfaces/protocol-params.interface";
import { addressToHex } from "../utils";

export interface TCRelayerConstructorParams extends TCBroadcasterParameters {
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
}
