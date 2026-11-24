import { RailgunWallet, buildShieldCalls, chainConfig, deriveRailgunAddress } from "./wallet.js";
import type { RailgunWasm } from "./wallet.js";
import type { Hex, RailgunAddress, ShieldEntry, TransferOptions, UnshieldOptions } from "./types.js";
import {
  deserializeError, serializeError,
  type FetchResult, type HostRequest, type ParentMessage, type WalletMetadata,
  type WorkerOpenInput,
} from "./worker-protocol.js";

export interface WorkerPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onMessage(handler: (message: ParentMessage) => void): void;
}

/** Runs WASM in an isolated worker so all Rust HTTP traffic uses the host's network policy. */
export function startRailgunWorker(port: WorkerPort, loadWasm: () => Promise<RailgunWasm>): void {
  let wallet: RailgunWallet | undefined;
  let callId: number | undefined;
  let nextHostId = 0;
  let wasmPromise: Promise<RailgunWasm> | undefined;
  const waiting = new Map<number, { resolve(value: FetchResult | undefined): void; reject(error: Error): void }>();

  function host(request: Omit<Extract<HostRequest, { method: "persist" }>, "type" | "id" | "callId">): Promise<void>;
  function host(request: Omit<Extract<HostRequest, { method: "fetch" }>, "type" | "id" | "callId">, signal: AbortSignal): Promise<FetchResult>;
  async function host(request: object, signal?: AbortSignal): Promise<unknown> {
    if (callId === undefined) throw new Error("Railgun host request outside an operation");
    signal?.throwIfAborted();
    const id = ++nextHostId;
    const abort = () => {
      port.postMessage({ type: "hostAbort", id });
      const pending = waiting.get(id);
      waiting.delete(id);
      pending?.reject(new DOMException("The request was aborted", "AbortError"));
    };
    try {
      return await new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        signal?.addEventListener("abort", abort, { once: true });
        port.postMessage({ ...request, type: "host", id, callId });
      });
    } finally {
      signal?.removeEventListener("abort", abort);
      waiting.delete(id);
    }
  }

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const result = await host({
      method: "fetch",
      url: request.url,
      init: {
        method: request.method,
        headers: [...request.headers],
        body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
        redirect: request.redirect,
        credentials: request.credentials,
      },
    }, request.signal);
    const noBody = request.method === "HEAD" || [204, 205, 304].includes(result.status);
    const response = new Response(noBody ? null : result.body, {
      status: result.status, statusText: result.statusText, headers: result.headers,
    });
    Object.defineProperties(response, {
      url: { value: result.url },
      redirected: { value: result.redirected },
    });
    return response;
  };

  function metadata(): WalletMetadata | undefined {
    if (!wallet) return undefined;
    return {
      chain: wallet.chain,
      address: wallet.address,
      syncedBlock: wallet.syncedBlock,
      pendingPoi: wallet.pendingPoi(),
      poiListKeys: wallet.poiListKeys(),
      recoveredValidTxids: wallet.recoveredValidTxids(),
    };
  }

  async function invoke(message: Extract<ParentMessage, { type: "call" }>): Promise<unknown> {
    const [arg, second, third] = message.args;
    const wasm = await (wasmPromise ??= loadWasm());
    switch (message.method) {
      case "chainConfig": return chainConfig(wasm, arg as bigint);
      case "deriveAddress": return deriveRailgunAddress(wasm, arg as Hex, second as Hex, third as bigint);
      case "buildShieldCalls": return buildShieldCalls(wasm, arg as bigint, second as RailgunAddress, third as ShieldEntry[]);
      case "open": {
        if (wallet) throw new Error("Railgun worker is already open");
        wallet = await RailgunWallet.open({
          ...arg as WorkerOpenInput,
          persistCheckpoint: (checkpoint) => host({ method: "persist", checkpoint }),
        }, wasm);
        return;
      }
    }
    if (!wallet) throw new Error("Railgun worker is not open");
    switch (message.method) {
      case "sync": return wallet.sync();
      case "syncTo": return wallet.syncTo(arg as bigint);
      case "syncHistoryTo": return wallet.syncHistoryTo(arg as bigint);
      case "refreshPoi": return wallet.refreshPoi();
      case "processPendingPoi": return wallet.processPendingPoi();
      case "balances": return wallet.balances();
      case "notes": return wallet.notes();
      case "prepareTransfer": return wallet.prepareTransfer(arg as TransferOptions);
      case "prepareUnshield": return wallet.prepareUnshield(arg as UnshieldOptions);
      case "checkpointJson": return wallet.checkpointJson();
      case "poiStatusPerList": return wallet.poiStatusPerList(arg as Hex);
      default: throw new Error(`Unknown Railgun worker method: ${message.method}`);
    }
  }

  port.onMessage(async (message) => {
    if (message.type === "hostResult") {
      const pending = waiting.get(message.id);
      if (!pending) return;
      waiting.delete(message.id);
      if (message.error) pending.reject(deserializeError(message.error));
      else pending.resolve(message.value);
      return;
    }
    if (callId !== undefined) {
      port.postMessage({ type: "result", id: message.id, error: serializeError(new Error("Concurrent Railgun worker call")) });
      return;
    }
    callId = message.id;
    try {
      const value = await invoke(message);
      port.postMessage({ type: "result", id: message.id, value, metadata: metadata() });
    } catch (error) {
      let current: WalletMetadata | undefined;
      try { current = metadata(); } catch { /* A trapped WASM session may be unreadable. */ }
      port.postMessage({ type: "result", id: message.id, error: serializeError(error), metadata: current });
    } finally {
      callId = undefined;
    }
  });
}
