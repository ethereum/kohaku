import * as Comlink from 'comlink';
import nodeEndpoint from 'comlink/dist/umd/node-adapter.js';
import { parentPort } from 'worker_threads';

import { registerHostBridge } from '../plugin/host-bridge.js';
import { workerApi } from './state-manager-api.js';
export type { WorkerApi } from './state-manager-api.js';

process.on('uncaughtException', (e) => {
  console.error('[worker] uncaught error', e.message, e.stack);
});
process.on('unhandledRejection', (e) => {
  console.error('[worker] unhandled rejection', e);
});

if (!parentPort) throw new Error('state-manager.worker.node must be run as a worker_threads Worker');

// Host objects arrive through the host bridge; it must be registered to receive them.
registerHostBridge();
Comlink.expose(workerApi, nodeEndpoint(parentPort));
