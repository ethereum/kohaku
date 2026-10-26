import { type Host } from "@kohaku-eth/plugins";
import { type Hex } from "../crypto/bytes";
import { relaySpend } from "../relayer/client";
import { type TacitBroadcaster, type TacitPrivateOperation } from "./types";

/** Submits a proven spend to the relayer it was prepared for. */
export class TacitRelayerBroadcaster implements TacitBroadcaster {
  constructor(private readonly host: Host) {}

  async broadcast(operation: TacitPrivateOperation): Promise<{ txHash: Hex }> {
    if (operation.mode !== "relayer" || !operation.relayerUrl) {
      throw new Error("tacit: this operation is sent by the user's own account; send operation.txns");
    }

    return { txHash: await relaySpend(this.host.network, operation.relayerUrl, operation.tx) };
  }
}
