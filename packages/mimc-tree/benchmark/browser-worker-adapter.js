import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('Browser worker adapter must run as a worker thread.');
}

const messageListeners = new Set();

Object.assign(globalThis, {
  postMessage(message) {
    parentPort?.postMessage(message);
  },
  addEventListener(type, listener) {
    if (type === 'message') {
      messageListeners.add(listener);
    }
  },
  removeEventListener(type, listener) {
    if (type === 'message') {
      messageListeners.delete(listener);
    }
  },
});

parentPort.on('message', (data) => {
  for (const listener of messageListeners) {
    listener({ data });
  }
});

await import(workerData.workerScriptUrl);
