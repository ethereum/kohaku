import { IRelayerClient, ISuccessfullRelayResponse } from "../relayer/interfaces/relayer-client.interface";
import { IPaymasterBroadcasterClient } from "../relayer/interfaces/paymaster-client.interface";
import { RelayerClient } from "../relayer/relayer-client";
import { PaymasterBroadcaster } from "../paymaster/paymaster-broadcaster";
import { PPv1Broadcaster, PPv1BroadcasterParameters } from "../v1";
import { PPv1RelayerConstructorParams } from "./base";
import { PPv1PaymasterPrivateOperation, PPv1PrivateOperation } from "./interfaces/protocol-params.interface";


export class PrivacyPoolsBroadcaster implements PPv1Broadcaster {
  relayersList: Record<string, string> = {};
  private relayerClient: IRelayerClient;
  private paymasterBroadcaster: IPaymasterBroadcasterClient;

  constructor({
    host,
    relayerClientFactory = () => new RelayerClient({ network: host.network }),
    broadcasterUrl,
    paymasterClientFactory = () => new PaymasterBroadcaster(),
  }: PPv1RelayerConstructorParams) {
    this.relayerClient = relayerClientFactory();
    this.relayersList = this.parseRelayers(broadcasterUrl);
    this.paymasterBroadcaster = paymasterClientFactory();
  }

  private parseRelayers(params: PPv1BroadcasterParameters["broadcasterUrl"]) {
    return typeof params === "string" ? { default: params } : params;
  }

  async broadcast(operation: PPv1PrivateOperation): Promise<ISuccessfullRelayResponse> {
    if (operation.mode === "paymaster") {
      return this.broadcastViaPaymaster(operation);
    }

    const {
      rawData: {
        chainId, scope, proof: { proof, publicSignals }, withdrawalPayload,
      }, quoteData: {
        relayerId, quote: { feeCommitment },
      },
    } = operation;

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

  private async broadcastViaPaymaster(
    operation: PPv1PaymasterPrivateOperation,
  ): Promise<ISuccessfullRelayResponse> {
    const [result] = await this.paymasterBroadcaster.broadcast([operation.withdrawal]);

    if (!result) {
      throw new Error("Paymaster withdrawal failed to broadcast.");
    }

    // Normalize the userOp result into the relayer response shape callers expect.
    return {
      success: true,
      timestamp: Date.now(),
      requestId: result.userOpHash,
      txHash: result.txHash,
    };
  }
}
