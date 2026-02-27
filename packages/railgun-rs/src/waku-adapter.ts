/**
 * @module WakuAdapter
 *
 * Adapter that owns the Waku LightNode lifecycle and exposes a minimal
 * interface for the Rust WASM transport to bind against.
 */

import {
  createDecoder,
  createEncoder,
  createLightNode,
  type CreateNodeOptions,
  Protocols,
  type IDecodedMessage,
  type LightNode,
  type QueryRequestParams,
} from "@waku/sdk";
import { JsBroadcasterManager, type WakuMessage } from "./pkg/railgun_rs.js";


const WAKU_RAILGUN_PUB_SUB_TOPIC = "/waku/2/rs/1/1";
const WAKU_RAILGUN_SHARD_CONFIG = {
  clusterId: 1,
  shard: 1,
  shardId: 1,
  pubsubTopic: WAKU_RAILGUN_PUB_SUB_TOPIC,
};

const HISTORICAL_LOOK_BACK_MS = 300_000;
const PEER_DISCOVERY_TIMEOUT_MS = 60_000;

/**
 * Convenience: create a `JsBroadcasterManager` from a new or existing
 * WakuAdapter.
 */
export async function createBroadcaster(
  chainId: bigint,
  whitelistedBroadcasters: string[] = [],
  adapter?: WakuAdapter,
  nodeOptions?: CreateNodeOptions
): Promise<JsBroadcasterManager> {
  const resolved = adapter ?? (await createWakuAdapter(nodeOptions));
  return new JsBroadcasterManager(chainId, resolved, whitelistedBroadcasters);
}

/**
 * Create a fully connected WakuAdapter (starts node + waits for peers).
 */
async function createWakuAdapter(
  options: CreateNodeOptions = {
    defaultBootstrap: true,
    networkConfig: { clusterId: 1 },
  }
): Promise<WakuAdapter> {
  const node = await createLightNode(options);
  await node.start();

  console.log("Waiting for Waku peers...");
  await node.waitForPeers(
    [Protocols.Filter, Protocols.LightPush, Protocols.Store],
    PEER_DISCOVERY_TIMEOUT_MS
  );

  const peers = await node.getConnectedPeers();
  console.log(`Connected to ${peers.length} Waku peers`);

  return new WakuAdapter(node);
}

/**
 * Owns the Waku LightNode and manages subscription state.
 * Designed to be passed into Rust via `JsWakuTransport::new()`.
 */
class WakuAdapter {
  private node: LightNode;
  private messageQueue: WakuMessage[] = [];
  private waiters: Array<(msg: WakuMessage | null) => void> = [];
  private closed = false;

  constructor(node: LightNode) {
    this.node = node;
  }


  /**
   * Subscribe to one or more content topics and enqueue matching messages for 
   * retrieval via `nextMessage()`.
   */
  async subscribe(topics: string[]): Promise<void> {
    const decoders = topics.map((t) =>
      createDecoder(t, WAKU_RAILGUN_SHARD_CONFIG)
    );

    await this.node.filter.subscribe(decoders, (decoded: IDecodedMessage) => {
      const msg = WakuAdapter.toWakuMessage(decoded);
      this.enqueue(msg);
    });
  }

  /**
   * Resolves with the next inbound message, or `null` if the adapter is
   * closed. If no message is queued the returned promise awaits until one arrives.
   */
  async nextMessage(): Promise<WakuMessage | null> {
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!;
    }
    if (this.closed) return null;

    return new Promise<WakuMessage | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Publish a payload to a content topic. */
  async send(topic: string, payload: Uint8Array): Promise<void> {
    const encoder = createEncoder({
      contentTopic: topic,
      routingInfo: WAKU_RAILGUN_SHARD_CONFIG,
    });
    await this.node.lightPush.send(encoder, { payload });
  }

  /**
   * Query the Waku store for historical messages on a content topic
   * within the look-back window.
   */
  async retrieveHistorical(topic: string): Promise<WakuMessage[]> {
    const decoder = createDecoder(topic, WAKU_RAILGUN_SHARD_CONFIG);
    const messages: WakuMessage[] = [];

    const options: QueryRequestParams = {
      includeData: true,
      pubsubTopic: WAKU_RAILGUN_PUB_SUB_TOPIC,
      contentTopics: [topic],
      paginationForward: true,
      timeStart: new Date(Date.now() - HISTORICAL_LOOK_BACK_MS),
      timeEnd: new Date(),
    };

    const generator = this.node.store.queryGenerator([decoder], options);

    for await (const page of generator) {
      for (const promise of page) {
        if (promise == null) continue;
        const decoded = await promise;
        if (decoded == null) continue;
        messages.push(WakuAdapter.toWakuMessage(decoded));
      }
    }

    return messages;
  }


  /**
   * Signal that no more messages will arrive. Unblocks any pending
   * `nextMessage()` calls with `null`.
   */
  close(): void {
    this.closed = true;
    for (const resolve of this.waiters) {
      resolve(null);
    }
    this.waiters = [];
  }

  private enqueue(msg: WakuMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(msg);
    } else {
      this.messageQueue.push(msg);
    }
  }

  private static toWakuMessage(decoded: IDecodedMessage): WakuMessage {
    return {
      payload: Array.from(decoded.payload),
      contentTopic: decoded.contentTopic,
      timestamp: decoded.timestamp ? decoded.timestamp.getTime() : undefined,
    };
  }
}

