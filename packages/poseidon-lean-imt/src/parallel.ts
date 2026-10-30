// Tree levels hashed on workers, level by level: node:worker_threads under Node,
// module Web Workers in the browser. The workers live until the root is computed.

// Kept in constants so bundlers do not try to resolve them for the browser.
const NODE_WORKER_THREADS_MODULE = "node:worker_threads";
const NODE_OS_MODULE = "node:os";

export type Reply = { parents: bigint[] } | { error: unknown };

// A started worker, the same over both runtimes.
interface Channel {
  send(nodes: bigint[]): void;
  // Returns a function that removes the listeners.
  listen(onReply: (reply: Reply) => void, onError: (error: unknown) => void): () => void;
  terminate(): unknown;
}

type NodeWorker = {
  postMessage(message: unknown): void;
  on(event: string, listener: (value: unknown) => void): void;
  off(event: string, listener: (value: unknown) => void): void;
  terminate(): Promise<number>;
};

type NodeWorkerThreads = { Worker: new (url: URL | string) => NodeWorker };

const isBrowser = typeof (globalThis as { Worker?: unknown }).Worker === "function";

// Past this many workers, startup and message passing outweigh the extra cores.
export const MAX_DEFAULT_WORKERS = 16;

export async function defaultWorkerCount(): Promise<number> {
  if (isBrowser) return Math.min(globalThis.navigator?.hardwareConcurrency ?? 4, MAX_DEFAULT_WORKERS);

  const os = (await import(NODE_OS_MODULE)) as { availableParallelism(): number };

  return Math.min(os.availableParallelism(), MAX_DEFAULT_WORKERS);
}

async function startNodeWorkers(count: number, workerUrl?: string | URL): Promise<Channel[]> {
  const { Worker } = (await import(NODE_WORKER_THREADS_MODULE)) as NodeWorkerThreads;
  // Sources run in tests, dist everywhere else.
  const url = workerUrl ?? new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url);

  return Array.from({ length: count }, () => {
    const worker = new Worker(url);

    return {
      send: (nodes) => worker.postMessage(nodes),
      listen(onReply, onError) {
        const onMessage = (value: unknown) => onReply(value as Reply);

        worker.on("message", onMessage);
        worker.on("error", onError);

        return () => {
          worker.off("message", onMessage);
          worker.off("error", onError);
        };
      },
      terminate: () => worker.terminate(),
    };
  });
}

function startBrowserWorkers(count: number, workerUrl?: string | URL): Channel[] {
  return Array.from({ length: count }, () => {
    // The literal new Worker(new URL(...)) form is what bundlers detect and emit.
    const worker = workerUrl
      ? new Worker(workerUrl, { type: "module" })
      : new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

    return {
      send: (nodes) => worker.postMessage(nodes),
      listen(onReply, onError) {
        const onMessage = (event: MessageEvent) => onReply(event.data as Reply);
        const onErrorEvent = (event: ErrorEvent) => onError(new Error(event.message));

        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onErrorEvent);

        return () => {
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onErrorEvent);
        };
      },
      terminate: () => worker.terminate(),
    };
  });
}

// Parents of nodes, hashed on channel. One request at a time per worker, so the
// next reply is this one's.
function nextLevel(channel: Channel, nodes: bigint[]): Promise<bigint[]> {
  return new Promise((resolve, reject) => {
    const unlisten = channel.listen(
      (reply) => {
        unlisten();

        if ("error" in reply) reject(reply.error);
        else resolve(reply.parents);
      },
      (error) => {
        unlisten();
        reject(error);
      },
    );

    channel.send(nodes);
  });
}

// All levels of the tree over leaves. The parents of each level are split in
// contiguous ranges, one per worker (at most one per parent), and the worker
// results joined in order are the next level. Pairs never cross a range, and only
// the last range can end without a right sibling, as in the whole level.
export async function parallelLevels(leaves: bigint[], workers: number, workerUrl?: string | URL): Promise<bigint[][]> {
  const levels = [leaves.slice()];
  // The first level has the most parents, n/2 rounded down.
  const count = Math.min(workers, leaves.length >> 1);
  const pool = isBrowser ? startBrowserWorkers(count, workerUrl) : await startNodeWorkers(count, workerUrl);

  try {
    while (levels[levels.length - 1].length > 1) {
      const prev = levels[levels.length - 1];
      const parents = Math.ceil(prev.length / 2);
      const used = Math.min(pool.length, parents);
      const jobs: Promise<bigint[]>[] = [];

      for (let w = 0; w < used; w++) {
        const from = Math.floor((w * parents) / used);
        const to = Math.floor(((w + 1) * parents) / used);

        jobs.push(nextLevel(pool[w], prev.slice(2 * from, 2 * to)));
      }
      levels.push((await Promise.all(jobs)).flat());
    }
  } finally {
    await Promise.all(pool.map((channel) => channel.terminate()));
  }

  return levels;
}
