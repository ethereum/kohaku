import {
  createMimcMerkleTree,
  createMimcMerkleTreeNodejsParallel,
  createMimcMerkleTreeParallel,
  MIMC_MERKLE_TREE_LEVELS,
} from '../lib/index.js';

const browserWorkerAdapterUrl = new URL('./browser-worker-adapter.js', import.meta.url);
const isNodeRuntime = Boolean(globalThis.process?.versions?.node);

async function createNodeBrowserWorkerFactory() {
  const { Worker: NodeWorker } = await import('node:worker_threads');
  const workers = [];
  const factory = (workerScriptUrl, options) => {
    const worker = new NodeWorker(browserWorkerAdapterUrl, {
      name: options.name,
      type: options.type,
      workerData: {
        workerScriptUrl: String(workerScriptUrl),
      },
    });
    const listeners = new Map();

    const browserWorker = {
      postMessage(message) {
        worker.postMessage(message);
      },
      terminate() {
        return worker.terminate();
      },
      addEventListener(type, listener) {
        const wrapped =
          type === 'message'
            ? (data) => listener({ data })
            : (error) =>
                listener({
                  error,
                  message: error instanceof Error ? error.message : String(error),
                });
        let eventListeners = listeners.get(type);
        if (!eventListeners) {
          eventListeners = new Map();
          listeners.set(type, eventListeners);
        }
        eventListeners.set(listener, wrapped);
        worker.on(type, wrapped);
      },
      removeEventListener(type, listener) {
        const eventListeners = listeners.get(type);
        const wrapped = eventListeners?.get(listener);
        if (!wrapped) {
          return;
        }
        worker.off(type, wrapped);
        eventListeners.delete(listener);
      },
    };

    workers.push(browserWorker);
    return browserWorker;
  };

  factory.terminateAll = async () => {
    await Promise.all(workers.map((worker) => worker.terminate()));
  };

  return factory;
}

const cases = [
  { label: '1k tree create', size: 1_000 },
  { label: '10k tree create', size: 10_000 },
  { label: '100k tree create', size: 100_000 },
].map(({ label, size }) => ({
  label,
  size,
  levels: MIMC_MERKLE_TREE_LEVELS,
  elements: Array.from({ length: size }, (_, index) => String(index)),
}));

let lastRoot;
const browserWorkerFactory = isNodeRuntime ? await createNodeBrowserWorkerFactory() : undefined;

const variants = [
  { label: 'createMimcMerkleTree', create: createMimcMerkleTree },
  ...(isNodeRuntime
    ? [
        {
          label: 'createMimcMerkleTreeNodejsParallel',
          create: createMimcMerkleTreeNodejsParallel,
          async: true,
        },
      ]
    : []),
  {
    label: 'createMimcMerkleTreeParallel',
    create: (elements, options) =>
      createMimcMerkleTreeParallel(elements, {
        ...options,
        // workerCount: 8,
        ...(browserWorkerFactory ? { workerFactory: browserWorkerFactory } : {}),
      }),
    async: true,
  },
];

try {
  for (const { label, levels, elements } of cases) {
    for (const variant of variants) {
      const run = variant.async
        ? async () => {
            const tree = await variant.create(elements, { levels });
            lastRoot = tree.root;
          }
        : () => {
            const tree = variant.create(elements, { levels });
            lastRoot = tree.root;
          };

      const start = process.hrtime.bigint();
      await run();
      const diff = process.hrtime.bigint() - start;
      console.log(`${label}, ${variant.label}`, diff/1_000_000n);
    }
  }
} finally {
  await browserWorkerFactory?.terminateAll();
}

if (lastRoot === undefined) {
  throw new Error('Benchmark did not run');
}
