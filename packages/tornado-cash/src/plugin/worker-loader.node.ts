import { wrap } from 'comlink';
import nodeEndpoint from 'comlink/dist/umd/node-adapter.js';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { WorkerApi } from '../state/state-manager-api';

export function loadStateManagerWorker(workerUrl?: string | URL) {
  if (workerUrl !== undefined) {
    console.warn('[worker-loader.node] workerUrl is ignored in Node.js — the worker file is always loaded from the local filesystem.');
  }

  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  const workerPath = resolve(thisDir, `./state-manager.worker.node.cjs`);

  const worker = new Worker(workerPath);

  return {
    remote: wrap<WorkerApi>(nodeEndpoint(worker)),
    onError: (handler: (err: Error) => void) => worker.on('error', handler),
  };
}
