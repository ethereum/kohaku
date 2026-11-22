import type { Host } from "@kohaku-eth/plugins";
import {
  sendUserOperation, waitForUserOperationReceipt,
  type UserOperationReceipt,
} from "./bundler.js";
import type { RailgunPrivateOperation } from "./plugin.js";
import type { Hex } from "./types.js";

export interface RailgunBroadcastResponse {
  id: Hex;
  wait(options?: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal }): Promise<UserOperationReceipt>;
}

export class RailgunBroadcaster {
  constructor(private readonly options: { host: Host }) {}

  async broadcast(operation: RailgunPrivateOperation): Promise<RailgunBroadcastResponse> {
    const chainId = await this.options.host.provider.getChainId();
    if (chainId !== operation.chainId) {
      throw new Error(`Host provider chain ${chainId} does not match Railgun operation chain ${operation.chainId}`);
    }
    const transport = {
      url: operation.bundlerUrl,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => this.options.host.network.fetch(input, init),
    };
    const id = await sendUserOperation(operation.prepared, transport);
    return { id, wait: (options) => waitForUserOperationReceipt(id, transport, options) };
  }
}
