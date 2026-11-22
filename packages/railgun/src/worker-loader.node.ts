import { Worker } from "node:worker_threads";
import { AsyncLocalStorage } from "node:async_hooks";
import type { RailgunWorkerHandle } from "./worker-handle.js";
import type { WorkerMessage } from "./worker-protocol.js";

export function createRailgunWorker(): RailgunWorkerHandle {
  const worker = new Worker(new URL("./railgun-worker.node.js", import.meta.url));
  return {
    postMessage: (message, transfer) => worker.postMessage(message, transfer as ArrayBuffer[]),
    onMessage: (handler) => worker.on("message", (message: WorkerMessage) => handler(message)),
    onError: (handler) => worker.on("error", handler),
    onExit: (handler) => worker.on("exit", handler),
    ref: () => worker.ref(),
    unref: () => worker.unref(),
    terminate: () => { void worker.terminate(); },
    captureContext: () => AsyncLocalStorage.snapshot(),
  };
}
