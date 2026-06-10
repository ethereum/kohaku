import { wrap } from 'comlink';
import type { WorkerApi } from '../state/state-manager-api';

export function loadStateManagerWorker(workerUrl?: string | URL) {
  const url = workerUrl ?? new URL('../state/state-manager.worker.js', import.meta.url);
  const worker = new Worker(url, { type: 'module' });

  return {
    remote: wrap<WorkerApi>(worker),
    onError: (handler: (err: Error) => void) =>
      worker.addEventListener('error', (e) => handler(e.error ?? new Error(e.message))),
  };
}
