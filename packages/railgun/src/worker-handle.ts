import type { WorkerMessage } from "./worker-protocol.js";

export interface RailgunWorkerHandle {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onMessage(handler: (message: WorkerMessage) => void): void;
  onError(handler: (error: Error) => void): void;
  onExit(handler: (code: number) => void): void;
  ref(): void;
  unref(): void;
  terminate(): void;
  captureContext(): <T>(fn: () => T) => T;
}
