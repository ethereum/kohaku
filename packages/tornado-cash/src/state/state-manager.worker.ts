/// <reference lib="webworker" />
import * as Comlink from 'comlink';

import { workerApi } from './state-manager-api.js';
export type { WorkerApi } from './state-manager-api.js';

self.addEventListener('error', (e) => {
  console.error('[worker] uncaught error', e.message, e.filename, e.lineno, e.error);
});
self.addEventListener('unhandledrejection', (e) => {
  console.error('[worker] unhandled rejection', e.reason);
});

Comlink.expose(workerApi);
