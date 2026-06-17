import { parentPort } from 'node:worker_threads';
import { __mimcHashLayerMontgomery } from './MimcMerkleTree.ts';

type MimcWorkerRequest = {
  nodes: bigint[];
  zero: bigint;
  startNodeIndex: number;
  previousLayerLength: number;
  signal: SharedArrayBuffer;
  port: {
    postMessage(message: unknown): void;
    close(): void;
  };
};

if (!parentPort) {
  throw new Error('MiMC worker must be started as a worker thread.');
}

parentPort.on('message', (value: unknown) => {
  const request = value as MimcWorkerRequest;
  const signal = new Int32Array(request.signal);

  try {
    request.port.postMessage({
      nodes: __mimcHashLayerMontgomery(
        request.nodes,
        request.zero,
        request.startNodeIndex,
        request.previousLayerLength,
      ),
    });
  } catch (error) {
    request.port.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    request.port.close();
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
  }
});
