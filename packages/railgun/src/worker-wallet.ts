import { createRailgunWorker } from "#worker-loader";
import type { RailgunWorkerHandle } from "./worker-handle.js";
import type {
  Hex, PendingPoi, PoiProcessReport, PoiStatus, PreparedUserOperation, RailgunAddress,
  RailgunBalance, RailgunChain, RailgunNote, RailgunWorkerOpenOptions, ShieldEntry,
  TransactionCall, TransferOptions, UnshieldOptions,
} from "./types.js";
import {
  deserializeError, serializeError, type HostRequest, type WalletMetadata,
  type WorkerMessage, type WorkerMethod, type WorkerOpenInput,
} from "./worker-protocol.js";

interface QueuedCall {
  id: number;
  method: WorkerMethod;
  args: unknown[];
  context: <T>(fn: () => T) => T;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** Serializes WASM operations off-thread; transport and encrypted storage stay on the host. */
export class RailgunWorkerWallet {
  private readonly worker: RailgunWorkerHandle;
  private readonly queue: QueuedCall[] = [];
  private readonly fetches = new Map<number, AbortController>();
  private active?: QueuedCall;
  private view?: WalletMetadata;
  private failure?: Error;
  private nextId = 0;

  private constructor(
    private readonly persist: RailgunWorkerOpenOptions["persistCheckpoint"],
    private readonly transport: typeof globalThis.fetch,
  ) {
    this.worker = createRailgunWorker();
    this.worker.onMessage((message: WorkerMessage) => this.receive(message));
    this.worker.onError((error) => this.stop(error));
    this.worker.onExit((code) => this.stop(new Error(`Railgun worker exited (${code})`)));
    this.worker.unref();
  }

  /** Creates a worker before a checkpoint is loaded, so callers can derive its address. */
  static create(options: Pick<RailgunWorkerOpenOptions, "persistCheckpoint" | "fetch">): RailgunWorkerWallet {
    if (typeof options.persistCheckpoint !== "function") {
      throw new TypeError("Railgun wallet requires a checkpoint persistence callback");
    }
    return new RailgunWorkerWallet(options.persistCheckpoint, options.fetch ?? globalThis.fetch);
  }

  static async open(options: RailgunWorkerOpenOptions): Promise<RailgunWorkerWallet> {
    const { persistCheckpoint, fetch: transport, ...input } = options;
    const wallet = RailgunWorkerWallet.create({ persistCheckpoint, fetch: transport });
    try {
      await wallet.initialize(input);
      return wallet;
    } catch (error) {
      wallet.close();
      throw error;
    }
  }

  initialize(options: WorkerOpenInput): Promise<void> { return this.call("open", [options]); }
  chainConfig(chainId: bigint): Promise<RailgunChain> { return this.call("chainConfig", [chainId]); }
  deriveAddress(spendingKey: Hex, viewingKey: Hex, chainId: bigint): Promise<RailgunAddress> {
    return this.call("deriveAddress", [spendingKey, viewingKey, chainId]);
  }
  buildShieldCalls(chainId: bigint, recipient: RailgunAddress, entries: readonly ShieldEntry[]): Promise<TransactionCall[]> {
    return this.call("buildShieldCalls", [chainId, recipient, entries]);
  }

  private current(): WalletMetadata {
    if (this.failure) throw this.failure;
    if (!this.view) throw new Error("Railgun worker is not open");
    return this.view;
  }

  get chain(): RailgunChain { return this.current().chain; }
  get address(): RailgunAddress { return this.current().address; }
  get syncedBlock(): bigint { return this.current().syncedBlock; }
  pendingPoi(): PendingPoi[] { return structuredClone(this.current().pendingPoi); }
  poiListKeys(): string[] { return [...this.current().poiListKeys]; }
  recoveredValidTxids(): string[] { return [...this.current().recoveredValidTxids]; }

  private call<T>(method: WorkerMethod, args: unknown[] = []): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.queue.length >= 32) return Promise.reject(new Error("Railgun worker queue is full"));
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: ++this.nextId, method, args, context: this.worker.captureContext(),
        resolve: (value) => resolve(value as T), reject,
      });
      this.drain();
    });
  }

  private drain(): void {
    if (this.active || this.failure) return;
    this.active = this.queue.shift();
    if (!this.active) { this.worker.unref(); return; }
    this.worker.ref();
    const { id, method, args } = this.active;
    try { this.worker.postMessage({ type: "call", id, method, args }); }
    catch (error) { this.stop(error instanceof Error ? error : new Error(String(error))); }
  }

  private receive(message: WorkerMessage): void {
    if (message.type === "hostAbort") {
      this.fetches.get(message.id)?.abort();
      return;
    }
    if (message.type === "host") {
      void this.host(message);
      return;
    }
    const active = this.active;
    if (!active || message.id !== active.id) return;
    if (message.metadata) this.view = message.metadata;
    this.active = undefined;
    if (message.error) active.reject(deserializeError(message.error));
    else active.resolve(message.value);
    this.drain();
  }

  private async host(message: HostRequest): Promise<void> {
    const active = this.active;
    if (!active || message.callId !== active.id || this.failure) return;
    try {
      if (message.method === "persist") {
        await active.context(() => this.persist(message.checkpoint));
        if (!this.failure) this.worker.postMessage({ type: "hostResult", id: message.id });
      } else {
        const controller = new AbortController();
        this.fetches.set(message.id, controller);
        const response = await active.context(() => this.transport(message.url, {
          ...message.init, signal: controller.signal,
        }));
        const body = await response.arrayBuffer();
        if (!this.failure) this.worker.postMessage({
          type: "hostResult", id: message.id,
          value: {
            status: response.status, statusText: response.statusText,
            headers: [...response.headers], url: response.url || message.url,
            redirected: response.redirected, body,
          },
        }, [body]);
      }
    } catch (error) {
      if (!this.failure) this.worker.postMessage({ type: "hostResult", id: message.id, error: serializeError(error) });
    } finally {
      this.fetches.delete(message.id);
    }
  }

  private stop(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.active?.reject(error);
    this.active = undefined;
    for (const pending of this.queue.splice(0)) pending.reject(error);
    for (const fetch of this.fetches.values()) fetch.abort();
    this.fetches.clear();
    this.view = undefined;
    this.worker.terminate();
  }

  async sync(): Promise<void> { await this.call("sync"); }
  async syncTo(block: bigint): Promise<void> { await this.call("syncTo", [block]); }
  async syncHistoryTo(block: bigint): Promise<void> { await this.call("syncHistoryTo", [block]); }
  async refreshPoi(): Promise<void> { await this.call("refreshPoi"); }
  processPendingPoi(): Promise<PoiProcessReport> { return this.call("processPendingPoi"); }
  balances(): Promise<RailgunBalance[]> { return this.call("balances"); }
  notes(): Promise<RailgunNote[]> { return this.call("notes"); }
  /** Secret checkpoint; unlike the direct wallet this getter is asynchronous. */
  checkpointJson(): Promise<string> { return this.call("checkpointJson"); }
  poiStatusPerList(commitment: Hex): Promise<Array<[string, PoiStatus]>> {
    return this.call("poiStatusPerList", [commitment]);
  }
  prepareTransfer(options: TransferOptions): Promise<PreparedUserOperation> {
    return this.call("prepareTransfer", [options]);
  }
  prepareUnshield(options: UnshieldOptions): Promise<PreparedUserOperation> {
    return this.call("prepareUnshield", [options]);
  }
  /** Cancels outstanding operations. Await mutations before closing to retain their checkpoint. */
  close(): void { this.stop(new Error("Railgun wallet is closed")); }
}
