// Worker for parallelLevels: replies to each slice of a level with its parents,
// or with the error. Lives until terminated. Runs under node:worker_threads and
// as a module Web Worker.

import { hashRange } from "./hash-range.ts";
import type { Reply } from "./parallel.ts";

const NODE_WORKER_THREADS_MODULE = "node:worker_threads";

type Port = {
  on(event: "message", listener: (value: unknown) => void): void;
  postMessage(value: unknown): void;
};

function parentsOf(nodes: bigint[]): Reply {
  try {
    return { parents: hashRange(nodes, 0, Math.ceil(nodes.length / 2)) };
  } catch (error) {
    return { error };
  }
}

const scope = globalThis as typeof globalThis & { WorkerGlobalScope?: unknown };

if (scope.WorkerGlobalScope !== undefined) {
  scope.addEventListener("message", (event) => scope.postMessage(parentsOf((event as MessageEvent<bigint[]>).data)));
} else {
  const { parentPort } = (await import(NODE_WORKER_THREADS_MODULE)) as { parentPort: Port | null };

  if (!parentPort) throw new Error("poseidon-lean-imt worker must be started as a worker thread");

  parentPort.on("message", (nodes) => parentPort.postMessage(parentsOf(nodes as bigint[])));
}
