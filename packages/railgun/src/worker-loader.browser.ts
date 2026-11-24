import type { RailgunWorkerHandle } from "./worker-handle.js";
import type { WorkerMessage } from "./worker-protocol.js";

export function createRailgunWorker(): RailgunWorkerHandle {
  const worker = new Worker(new URL("./railgun-worker.browser.js", import.meta.url), { type: "module" });
  const exits: Array<(code: number) => void> = [];
  return {
    postMessage: (message, transfer) => worker.postMessage(message, { transfer }),
    onMessage: (handler) => worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => handler(event.data)),
    onError: (handler) => worker.addEventListener("error", (event) => handler(event.error instanceof Error ? event.error : new Error(event.message))),
    onExit: (handler) => { exits.push(handler); },
    ref: () => {},
    unref: () => {},
    terminate: () => {
      worker.terminate();
      for (const handler of exits) handler(0);
    },
    captureContext: () => <T>(fn: () => T) => fn(),
  };
}
