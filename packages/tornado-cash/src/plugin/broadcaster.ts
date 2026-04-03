import { IRelayerClient, ISuccessfullRelayResponse } from "../relayer/interfaces/relayer-client.interface";
import { RelayerClient } from "../relayer/relayer-client";
import { PPv1Broadcaster, PPv1BroadcasterParameters } from "../v1";
import { PPv1RelayerConstructorParams } from "./base";
import { PPv1PrivateOperation } from "./interfaces/protocol-params.interface";


export class PrivacyPoolsBroadcaster implements PPv1Broadcaster {
  relayersList: Record<string, string> = {};
  private relayerClient: IRelayerClient;

  constructor({
    host, relayerClientFactory = () => new RelayerClient({ network: host.network }), broadcasterUrl,
  }: PPv1RelayerConstructorParams) {
    this.relayerClient = relayerClientFactory();
    this.relayersList = this.parseRelayers(broadcasterUrl);
  }

  private parseRelayers(params: PPv1BroadcasterParameters["broadcasterUrl"]) {
    return typeof params === "string" ? { default: params } : params;
  }

  async broadcast({
    rawData: {
      chainId, scope, proof: { proof, publicSignals }, withdrawalPayload,
    }, quoteData: {
      relayerId, quote: { feeCommitment },
    },
  }: PPv1PrivateOperation): Promise<ISuccessfullRelayResponse> {
    const relayerUrl = this.relayersList[relayerId];

    if (!relayerUrl) {
      throw new Error("Specified relayer not found.");
    }

    return this.relayerClient.relay({
      chainId,
      scope,
      feeCommitment,
      relayerUrl,
      withdrawal: withdrawalPayload,
      publicSignals,
      proof,
    });

  }
}
