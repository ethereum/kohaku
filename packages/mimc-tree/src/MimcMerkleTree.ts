/* eslint-disable no-restricted-syntax */
/* eslint-disable max-lines */
import { getConstants } from 'micro-zk-proofs/mimcsponge.js';
import { initWrkr, stringifyError, type Message, type WrkrAPI } from 'micro-wrkr/utils.js';
import { MerkleTree } from 'fixed-merkle-tree';
import type { Element, HashFunction, MerkleTreeOptions } from 'fixed-merkle-tree';

export const MIMC_MERKLE_TREE_LEVELS = 20;
export const MIMC_MERKLE_TREE_ZERO_VALUE =
  '21663839004416932945382355908790599225266501822907911457504978515578255421292';

const BN254_SCALAR_FIELD_SIZE = BigInt('0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001');
const MONTGOMERY_BITS = 256n;
const MONTGOMERY_R = 1n << MONTGOMERY_BITS;
const MONTGOMERY_MASK = MONTGOMERY_R - 1n;
const MONTGOMERY_R2 = (MONTGOMERY_R * MONTGOMERY_R) % BN254_SCALAR_FIELD_SIZE;
const MONTGOMERY_NEG_FIELD_INVERSE = getMontgomeryNegFieldInverse(BN254_SCALAR_FIELD_SIZE);
const MIMC_SPONGE_ROUNDS = 220;
const MIMC_SPONGE_CONSTANTS = getConstants('mimcsponge', MIMC_SPONGE_ROUNDS);
const MIMC_SPONGE_CONSTANTS_MONTGOMERY = MIMC_SPONGE_CONSTANTS.map(mimcMontgomeryFromField);
const MIMC_MERKLE_TREE_ZERO_VALUE_BIGINT = BigInt(MIMC_MERKLE_TREE_ZERO_VALUE);
const MIMC_MERKLE_TREE_ZERO_VALUE_MONTGOMERY = mimcMontgomeryFromField(MIMC_MERKLE_TREE_ZERO_VALUE_BIGINT);
const MIMC_MERKLE_TREE_ZEROS_MONTGOMERY = [MIMC_MERKLE_TREE_ZERO_VALUE_MONTGOMERY];
const MIMC_PARALLEL_PARENT_THRESHOLD = 128;
const MIMC_MAX_WORKERS = 8;

export type MimcMerkleTreeLeaf = Element | bigint;

export type MimcMerkleTreeOptions = MerkleTreeOptions & {
  levels?: number;
};

export type MimcMerkleProof = {
  index: number;
  root: bigint;
  siblings: bigint[];
  pathIndices: number[];
};

type MimcNodeWorkerRequest = {
  nodes: bigint[];
  zero: bigint;
  startNodeIndex: number;
  previousLayerLength: number;
  signal: SharedArrayBuffer;
  port: NodeMessagePort;
};

type MimcWorkerResponse = {
  nodes?: bigint[];
  error?: string;
};

type NodeMessagePort = {
  postMessage(message: unknown): void;
  close(): void;
};

type NodeWorker = {
  postMessage(value: unknown, transferList?: readonly unknown[]): void;
  unref?: () => void;
};

type NodeWorkerThreads = {
  Worker: new (filename: URL | string, options?: { type?: 'module' }) => NodeWorker;
  MessageChannel: new () => {
    port1: NodeMessagePort;
    port2: NodeMessagePort;
  };
  receiveMessageOnPort(port: NodeMessagePort): { message: unknown } | undefined;
};

type NodeOs = {
  availableParallelism?: () => number;
};

type BrowserWorkerEvent = {
  data?: unknown;
  message?: string;
  error?: unknown;
};

type BrowserWorkerEventListener = (event: BrowserWorkerEvent) => void;

type BrowserWorker = {
  postMessage(message: unknown): void;
  terminate(): unknown;
  addEventListener(type: string, listener: BrowserWorkerEventListener): void;
  removeEventListener(type: string, listener: BrowserWorkerEventListener): void;
};

type BrowserWorkerOptions = {
  type: 'module';
  name?: string;
};

type BrowserWorkerConstructor = new (scriptURL: string | URL, options?: BrowserWorkerOptions) => BrowserWorker;

export type MimcBrowserWorkerFactory = (
  workerUrl: string | URL,
  options: BrowserWorkerOptions,
) => BrowserWorker;

export type MimcMerkleTreeParallelOptions = MimcMerkleTreeOptions & {
  workerCount?: number;
  workerUrl?: string | URL;
  workerFactory?: MimcBrowserWorkerFactory;
};

export type MimcMerkleTreeBrowserParallelOptions = MimcMerkleTreeParallelOptions;

export type __MimcBrowserWorkerLayerInput = [left: bigint, right: bigint];

export type __MimcBrowserWorkerHandlers = {
  hashLayer(input: __MimcBrowserWorkerLayerInput[]): bigint[];
};

type MimcBrowserWorkerBatch = {
  methods: {
    hashLayer(input: __MimcBrowserWorkerLayerInput[], threads?: number): Promise<bigint[]>;
  };
  terminate(): void;
};

type ResolvedMimcMerkleTreeOptions = {
  levels: number;
  hashFunction: HashFunction<Element>;
  zeroElement: Element;
};

type MimcLayerHasher = (previousLayer: bigint[], zero: bigint) => bigint[];
type MimcAsyncLayerHasher = (previousLayer: bigint[], zero: bigint) => bigint[] | Promise<bigint[]>;

const NODE_OS_MODULE = 'node:os';
const NODE_WORKER_THREADS_MODULE = 'node:worker_threads';

let mimcWorkerPool: NodeWorker[] | undefined;
let mimcBrowserWorkerBatch: MimcBrowserWorkerBatch | undefined;
let mimcBrowserWorkerBatchSize = 0;
let mimcBrowserWorkerBatchUrl: string | undefined;
let mimcBrowserWorkerBatchFactory: MimcBrowserWorkerFactory | undefined;
let nodeOsImport: Promise<NodeOs> | undefined;
let nodeWorkerThreadsImport: Promise<NodeWorkerThreads> | undefined;

const mimcBrowserWrkr: WrkrAPI = initWrkr({
  cpus: (): number | undefined => {
    const browserGlobal = globalThis as typeof globalThis & {
      navigator?: {
        hardwareConcurrency?: number;
      };
    };

    return browserGlobal.navigator?.hardwareConcurrency;
  },
  initWorker(handlers): void {
    const workerScope = globalThis as typeof globalThis & Partial<{
      postMessage(message: unknown): void;
      addEventListener(type: 'message', listener: (event: BrowserWorkerEvent) => void): void;
    }>;

    if (!workerScope.postMessage || !workerScope.addEventListener) {
      throw new Error('MiMC browser worker must be started as a Web Worker.');
    }

    workerScope.addEventListener('message', (event: BrowserWorkerEvent) => {
      const { id, fn, payload } = event.data as Message;

      try {
        workerScope.postMessage?.({
          id,
          res: handlers[fn](payload),
        });
      } catch (error) {
        workerScope.postMessage?.({
          id,
          err: stringifyError(error),
        });
      }
    });
  },
  createWorker(getWorker, onMessage, onError) {
    const worker = getWorker() as unknown as BrowserWorker;

    worker.addEventListener('message', (event: BrowserWorkerEvent) => {
      onMessage(event.data as Message);
    });
    worker.addEventListener('error', (event: BrowserWorkerEvent) => {
      onError(getBrowserWorkerErrorMessage(event));
    });
    worker.addEventListener('messageerror', (event: BrowserWorkerEvent) => {
      onError(getBrowserWorkerErrorMessage(event));
    });

    return {
      send: (message): void => worker.postMessage(message),
      terminate: (): void => {
        worker.terminate();
      },
    };
  },
});

export function __initMimcBrowserWorker(handlers: __MimcBrowserWorkerHandlers): void {
  mimcBrowserWrkr.initWorker(handlers);
}

function getMontgomeryNegFieldInverse(modulus: bigint): bigint {
  let inverse = 1n;

  for (let i = 0; i < 8; i++) {
    inverse = (inverse * (2n - modulus * inverse)) & MONTGOMERY_MASK;
  }

  return -inverse & MONTGOMERY_MASK;
}

function mimcFieldMod(value: bigint): bigint {
  const result = value % BN254_SCALAR_FIELD_SIZE;

  return result >= 0n ? result : result + BN254_SCALAR_FIELD_SIZE;
}

function mimcMontgomeryReduce(value: bigint): bigint {
  const quotient = ((value & MONTGOMERY_MASK) * MONTGOMERY_NEG_FIELD_INVERSE) & MONTGOMERY_MASK;
  let reduced = (value + quotient * BN254_SCALAR_FIELD_SIZE) >> MONTGOMERY_BITS;

  if (reduced >= BN254_SCALAR_FIELD_SIZE) reduced -= BN254_SCALAR_FIELD_SIZE;

  return reduced;
}

function mimcMontgomeryMultiply(left: bigint, right: bigint): bigint {
  return mimcMontgomeryReduce(left * right);
}

function mimcMontgomeryFromField(value: bigint): bigint {
  return mimcMontgomeryMultiply(mimcFieldMod(value), MONTGOMERY_R2);
}

function mimcMontgomeryToField(value: bigint): bigint {
  return mimcMontgomeryReduce(value);
}

function mimcSpongeUpdateMontgomery(
  input: bigint,
  spongeLeft: bigint,
  spongeRight: bigint,
): [bigint, bigint] {
  const constants = MIMC_SPONGE_CONSTANTS_MONTGOMERY;
  const fieldSize = BN254_SCALAR_FIELD_SIZE;
  const inverse = MONTGOMERY_NEG_FIELD_INVERSE;
  const mask = MONTGOMERY_MASK;
  let left = spongeLeft + input;

  if (left >= fieldSize) left -= fieldSize;

  let right = spongeRight;

  for (let round = 0; round < MIMC_SPONGE_ROUNDS; round++) {
    let t = left + constants[round];

    if (t >= fieldSize) t -= fieldSize;

    let product = t * t;
    let quotient = ((product & mask) * inverse) & mask;
    let squared = (product + quotient * fieldSize) >> MONTGOMERY_BITS;

    if (squared >= fieldSize) squared -= fieldSize;

    product = squared * squared;
    quotient = ((product & mask) * inverse) & mask;
    let fourthPower = (product + quotient * fieldSize) >> MONTGOMERY_BITS;

    if (fourthPower >= fieldSize) fourthPower -= fieldSize;

    product = fourthPower * t;
    quotient = ((product & mask) * inverse) & mask;
    let fifthPower = (product + quotient * fieldSize) >> MONTGOMERY_BITS;

    if (fifthPower >= fieldSize) fifthPower -= fieldSize;

    let nextRight = right + fifthPower;

    if (nextRight >= fieldSize) nextRight -= fieldSize;

    if (round < MIMC_SPONGE_ROUNDS - 1) {
      right = left;
      left = nextRight;
    } else {
      right = nextRight;
    }
  }

  return [left, right];
}

function mimcMerkleTreeHashMontgomery(left: bigint, right: bigint): bigint {
  const [firstLeft, firstRight] = mimcSpongeUpdateMontgomery(left, 0n, 0n);

  return mimcSpongeUpdateMontgomery(right, firstLeft, firstRight)[0];
}

export function __mimcHashLayerMontgomery(
  nodes: bigint[],
  zero: bigint,
  startNodeIndex: number = 0,
  previousLayerLength: number = nodes.length,
): bigint[] {
  const currentLayerLength = Math.ceil(nodes.length / 2);
  const currentLayer = new Array<bigint>(currentLayerLength);

  for (let nodeIndex = 0, parentIndex = 0; nodeIndex < nodes.length; nodeIndex += 2, parentIndex++) {
    const globalNodeIndex = startNodeIndex + nodeIndex;
    const left = nodes[nodeIndex];
    const right = globalNodeIndex + 1 < previousLayerLength ? nodes[nodeIndex + 1] : zero;

    currentLayer[parentIndex] = mimcMerkleTreeHashMontgomery(left, right);
  }

  return currentLayer;
}

export function __mimcHashLayerPairsMontgomery(pairs: __MimcBrowserWorkerLayerInput[]): bigint[] {
  return pairs.map(([left, right]) => mimcMerkleTreeHashMontgomery(left, right));
}

function mimcMerkleTreeHashBigInt(left: bigint, right: bigint): bigint {
  return mimcMontgomeryToField(
    mimcMerkleTreeHashMontgomery(mimcMontgomeryFromField(left), mimcMontgomeryFromField(right)),
  );
}

function getMimcMerkleTreeZerosMontgomery(levels: number): bigint[] {
  for (let level = MIMC_MERKLE_TREE_ZEROS_MONTGOMERY.length; level <= levels; level++) {
    const previous = MIMC_MERKLE_TREE_ZEROS_MONTGOMERY[level - 1];

    MIMC_MERKLE_TREE_ZEROS_MONTGOMERY[level] = mimcMerkleTreeHashMontgomery(previous, previous);
  }

  return MIMC_MERKLE_TREE_ZEROS_MONTGOMERY.slice(0, levels + 1);
}

function getMimcWorkerUrl(): URL {
  return new URL(
    import.meta.url.endsWith('.ts') ? './MimcMerkleTreeWorker.ts' : './MimcMerkleTreeWorker.js',
    import.meta.url,
  );
}

function getMimcBrowserWorkerUrl(): URL {
  return new URL(
    import.meta.url.endsWith('.ts')
      ? './MimcMerkleTreeBrowserWorker.ts'
      : './MimcMerkleTreeBrowserWorker.js',
    import.meta.url,
  );
}

function isNodeRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      versions?: {
        node?: string;
      };
    };
  };

  return Boolean(runtime.process?.versions?.node);
}

async function importNodeOs(): Promise<NodeOs> {
  if (!isNodeRuntime()) {
    return {};
  }

  nodeOsImport ??= import(NODE_OS_MODULE) as Promise<NodeOs>;

  return nodeOsImport;
}

async function importNodeWorkerThreads(): Promise<NodeWorkerThreads> {
  if (!isNodeRuntime()) {
    throw new Error(
      'MiMC Node.js parallel tree creation requires Node.js worker_threads. Use createMimcMerkleTreeParallel in browser runtimes.',
    );
  }

  nodeWorkerThreadsImport ??= import(NODE_WORKER_THREADS_MODULE) as Promise<NodeWorkerThreads>;

  return nodeWorkerThreadsImport;
}

async function getAvailableParallelism(): Promise<number> {
  const os = await importNodeOs();

  return Math.max(1, os.availableParallelism?.() ?? 1);
}

function getBrowserAvailableParallelism(workerCount?: number): number {
  if (workerCount !== undefined) {
    if (!Number.isFinite(workerCount) || workerCount < 1) {
      throw new Error('Browser workerCount must be a positive number.');
    }

    return Math.floor(workerCount);
  }

  return Math.max(1, Math.floor(mimcBrowserWrkr.getConcurrency()));
}

function getMimcWorkerPool(size: number, workerThreads: NodeWorkerThreads): NodeWorker[] {
  if (mimcWorkerPool && mimcWorkerPool.length >= size) {
    return mimcWorkerPool;
  }

  const workerUrl = getMimcWorkerUrl();
  const workers = mimcWorkerPool ?? [];

  for (let index = workers.length; index < size; index++) {
    const worker = new workerThreads.Worker(workerUrl, { type: 'module' });

    worker.unref?.();
    workers[index] = worker;
  }
  mimcWorkerPool = workers;

  return workers;
}

function createDefaultMimcBrowserWorker(workerUrl: string | URL, options: BrowserWorkerOptions): BrowserWorker {
  const browserGlobal = globalThis as typeof globalThis & {
    Worker?: BrowserWorkerConstructor;
  };

  if (!browserGlobal.Worker) {
    throw new Error(
      'MiMC browser parallel tree creation requires Web Worker support. Use createMimcMerkleTree when workers are unavailable.',
    );
  }

  return new browserGlobal.Worker(workerUrl, options);
}

function resetMimcBrowserWorkerBatch(): void {
  mimcBrowserWorkerBatch?.terminate();
  mimcBrowserWorkerBatch = undefined;
  mimcBrowserWorkerBatchSize = 0;
  mimcBrowserWorkerBatchUrl = undefined;
  mimcBrowserWorkerBatchFactory = undefined;
}

function getMimcBrowserWorkerBatch(
  size: number,
  workerUrl: string | URL,
  workerFactory: MimcBrowserWorkerFactory,
): MimcBrowserWorkerBatch {
  const workerUrlKey = String(workerUrl);

  if (
    mimcBrowserWorkerBatch &&
    mimcBrowserWorkerBatchSize >= size &&
    mimcBrowserWorkerBatchUrl === workerUrlKey &&
    mimcBrowserWorkerBatchFactory === workerFactory
  ) {
    return mimcBrowserWorkerBatch;
  }

  if (mimcBrowserWorkerBatch) {
    resetMimcBrowserWorkerBatch();
  }

  let workerIndex = 0;
  const getWorker = (): BrowserWorker =>
    workerFactory(workerUrl, {
      type: 'module',
      name: `mimc-merkle-tree-${workerIndex++}`,
    });
  const initBatch = mimcBrowserWrkr.initBatch as unknown as (
    getWorker: () => BrowserWorker,
    reducers: { hashLayer: undefined },
    threads: number,
  ) => MimcBrowserWorkerBatch;

  mimcBrowserWorkerBatch = initBatch(getWorker, { hashLayer: undefined }, size);
  mimcBrowserWorkerBatchSize = size;
  mimcBrowserWorkerBatchUrl = workerUrlKey;
  mimcBrowserWorkerBatchFactory = workerFactory;

  return mimcBrowserWorkerBatch;
}

function getMimcWorkerCount(parentLength: number, availableParallelism: number): number {
  if (parentLength < MIMC_PARALLEL_PARENT_THRESHOLD) {
    return 0;
  }

  return Math.min(
    MIMC_MAX_WORKERS,
    Math.max(1, availableParallelism),
    Math.ceil(parentLength / MIMC_PARALLEL_PARENT_THRESHOLD),
  );
}

function hashMimcLayerWithWorkers(
  previousLayer: bigint[],
  zero: bigint,
  workerCount: number,
  workerThreads: NodeWorkerThreads,
): bigint[] {
  const previousLayerLength = previousLayer.length;
  const parentLength = Math.ceil(previousLayerLength / 2);
  const workers = getMimcWorkerPool(workerCount, workerThreads);
  const currentLayer = new Array<bigint>(parentLength);
  const jobs: Array<{ parentStart: number; port: NodeMessagePort; signal: Int32Array }> = [];
  const parentChunkSize = Math.ceil(parentLength / workerCount);

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
    const parentStart = workerIndex * parentChunkSize;
    const parentEnd = Math.min(parentStart + parentChunkSize, parentLength);

    if (parentStart >= parentEnd) {
      break;
    }

    const nodeStart = parentStart * 2;
    const nodeEnd = Math.min(parentEnd * 2, previousLayerLength);
    const { port1, port2 } = new workerThreads.MessageChannel();
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const request: MimcNodeWorkerRequest = {
      nodes: previousLayer.slice(nodeStart, nodeEnd),
      zero,
      startNodeIndex: nodeStart,
      previousLayerLength,
      signal: signal.buffer as SharedArrayBuffer,
      port: port2,
    };

    workers[workerIndex].postMessage(request, [port2]);
    jobs.push({ parentStart, port: port1, signal });
  }

  for (const job of jobs) {
    Atomics.wait(job.signal, 0, 0);
    const response = workerThreads.receiveMessageOnPort(job.port)?.message as MimcWorkerResponse | undefined;

    job.port.close();

    if (!response) {
      throw new Error('MiMC worker did not return a response.');
    }

    if (response.error) {
      throw new Error(response.error);
    }

    if (!response.nodes) {
      throw new Error('MiMC worker returned an empty response.');
    }

    for (let index = 0; index < response.nodes.length; index++) {
      currentLayer[job.parentStart + index] = response.nodes[index];
    }
  }

  return currentLayer;
}

function getBrowserWorkerErrorMessage(event: BrowserWorkerEvent): string {
  if (event.error instanceof Error) {
    return event.error.message;
  }

  if (event.error !== undefined) {
    return String(event.error);
  }

  return event.message ?? 'MiMC browser worker failed.';
}

async function hashMimcLayerWithBrowserWorkers(
  previousLayer: bigint[],
  zero: bigint,
  workerCount: number,
  workerUrl: string | URL,
  workerFactory: MimcBrowserWorkerFactory,
): Promise<bigint[]> {
  const previousLayerLength = previousLayer.length;
  const parentLength = Math.ceil(previousLayerLength / 2);
  const batch = getMimcBrowserWorkerBatch(workerCount, workerUrl, workerFactory);
  const pairs = new Array<__MimcBrowserWorkerLayerInput>(parentLength);

  for (let parentIndex = 0; parentIndex < parentLength; parentIndex++) {
    const nodeIndex = parentIndex * 2;
    const right = nodeIndex + 1 < previousLayerLength ? previousLayer[nodeIndex + 1] : zero;

    pairs[parentIndex] = [previousLayer[nodeIndex], right];
  }

  return batch.methods.hashLayer(pairs, workerCount);
}

function hashMimcLayerSingleThreaded(previousLayer: bigint[], zero: bigint): bigint[] {
  return __mimcHashLayerMontgomery(previousLayer, zero);
}

function hashMimcLayerMultiThreaded(
  previousLayer: bigint[],
  zero: bigint,
  workerThreads: NodeWorkerThreads,
  availableParallelism: number,
): bigint[] {
  const workerCount = getMimcWorkerCount(Math.ceil(previousLayer.length / 2), availableParallelism);

  return workerCount > 1
    ? hashMimcLayerWithWorkers(previousLayer, zero, workerCount, workerThreads)
    : hashMimcLayerSingleThreaded(previousLayer, zero);
}

function hashMimcLayerBrowserParallel(
  previousLayer: bigint[],
  zero: bigint,
  workerUrl: string | URL,
  workerFactory: MimcBrowserWorkerFactory,
  availableParallelism: number,
): Promise<bigint[]> | bigint[] {
  const workerCount = getMimcWorkerCount(Math.ceil(previousLayer.length / 2), availableParallelism);

  return workerCount > 1
    ? hashMimcLayerWithBrowserWorkers(previousLayer, zero, workerCount, workerUrl, workerFactory)
    : hashMimcLayerSingleThreaded(previousLayer, zero);
}

function validateMimcMerkleTreeCapacity(levels: number, leaves: MimcMerkleTreeLeaf[]): void {
  if (leaves.length > 2 ** levels) {
    throw new Error('Tree is full');
  }
}

function serializeDefaultMimcMerkleTree(
  levels: number,
  leaves: MimcMerkleTreeLeaf[],
  zeros: bigint[],
  layers: bigint[][],
): MerkleTree {
  const serializedLayers: Element[][] = [leaves.map(String)];

  for (let layerIndex = 1; layerIndex <= levels; layerIndex++) {
    serializedLayers[layerIndex] = layers[layerIndex].map((node) => String(mimcMontgomeryToField(node)));
  }

  return MerkleTree.deserialize(
    {
      levels,
      _zeros: zeros.map((zero) => String(mimcMontgomeryToField(zero))),
      _layers: serializedLayers,
    },
    mimcMerkleTreeHash,
  );
}

function initDefaultMimcMerkleTreeLayers(
  levels: number,
  leaves: MimcMerkleTreeLeaf[],
): { zeros: bigint[]; layers: bigint[][] } {
  validateMimcMerkleTreeCapacity(levels, leaves);

  return {
    zeros: getMimcMerkleTreeZerosMontgomery(levels),
    layers: [leaves.map((leaf) => mimcMontgomeryFromField(BigInt(leaf)))],
  };
}

function buildDefaultMimcMerkleTree(
  levels: number,
  leaves: MimcMerkleTreeLeaf[],
  hashLayer: MimcLayerHasher,
): MerkleTree {
  const { zeros, layers } = initDefaultMimcMerkleTreeLayers(levels, leaves);

  for (let layerIndex = 1; layerIndex <= levels; layerIndex++) {
    layers[layerIndex] = hashLayer(layers[layerIndex - 1], zeros[layerIndex - 1]);
  }

  return serializeDefaultMimcMerkleTree(levels, leaves, zeros, layers);
}

async function buildDefaultMimcMerkleTreeAsync(
  levels: number,
  leaves: MimcMerkleTreeLeaf[],
  hashLayer: MimcAsyncLayerHasher,
): Promise<MerkleTree> {
  const { zeros, layers } = initDefaultMimcMerkleTreeLayers(levels, leaves);

  for (let layerIndex = 1; layerIndex <= levels; layerIndex++) {
    layers[layerIndex] = await hashLayer(layers[layerIndex - 1], zeros[layerIndex - 1]);
  }

  return serializeDefaultMimcMerkleTree(levels, leaves, zeros, layers);
}

function createDefaultMimcMerkleTreeSingleThreaded(levels: number, leaves: MimcMerkleTreeLeaf[]): MerkleTree {
  return buildDefaultMimcMerkleTree(levels, leaves, hashMimcLayerSingleThreaded);
}

async function createDefaultMimcMerkleTreeMultiThreaded(
  levels: number,
  leaves: MimcMerkleTreeLeaf[],
): Promise<MerkleTree> {
  const [workerThreads, availableParallelism] = await Promise.all([
    importNodeWorkerThreads(),
    getAvailableParallelism(),
  ]);

  return buildDefaultMimcMerkleTree(levels, leaves, (previousLayer, zero) =>
    hashMimcLayerMultiThreaded(previousLayer, zero, workerThreads, availableParallelism),
  );
}

async function createDefaultMimcMerkleTreeBrowserParallel(
  levels: number,
  leaves: MimcMerkleTreeLeaf[],
  {
    workerCount,
    workerUrl = getMimcBrowserWorkerUrl(),
    workerFactory = createDefaultMimcBrowserWorker,
  }: MimcMerkleTreeParallelOptions,
): Promise<MerkleTree> {
  const availableParallelism = getBrowserAvailableParallelism(workerCount);

  return buildDefaultMimcMerkleTreeAsync(levels, leaves, (previousLayer, zero) =>
    hashMimcLayerBrowserParallel(previousLayer, zero, workerUrl, workerFactory, availableParallelism),
  );
}

function resolveMimcMerkleTreeOptions({
  levels = MIMC_MERKLE_TREE_LEVELS,
  hashFunction = mimcMerkleTreeOptions.hashFunction,
  zeroElement = mimcMerkleTreeOptions.zeroElement,
}: MimcMerkleTreeOptions = {}): ResolvedMimcMerkleTreeOptions {
  return { levels, hashFunction, zeroElement };
}

function usesDefaultMimcMerkleTreeOptions({
  hashFunction,
  zeroElement,
}: ResolvedMimcMerkleTreeOptions): boolean {
  return hashFunction === mimcMerkleTreeHash && String(zeroElement) === MIMC_MERKLE_TREE_ZERO_VALUE;
}

function createCustomMimcMerkleTree(
  leaves: MimcMerkleTreeLeaf[],
  { levels, hashFunction, zeroElement }: ResolvedMimcMerkleTreeOptions,
): MerkleTree {
  return new MerkleTree(levels, leaves.map(String), { hashFunction, zeroElement });
}

function createMimcMerkleTreeWithDefault<T extends MerkleTree | Promise<MerkleTree>>(
  leaves: MimcMerkleTreeLeaf[],
  options: MimcMerkleTreeOptions,
  createDefault: (levels: number, leaves: MimcMerkleTreeLeaf[]) => T,
): T | MerkleTree {
  const treeOptions = resolveMimcMerkleTreeOptions(options);

  return usesDefaultMimcMerkleTreeOptions(treeOptions)
    ? createDefault(treeOptions.levels, leaves)
    : createCustomMimcMerkleTree(leaves, treeOptions);
}

function mimcMerkleProofFromTree(tree: MerkleTree, leaf: MimcMerkleTreeLeaf): MimcMerkleProof {
  const leafElement = String(leaf);
  const index = tree.indexOf(leafElement);

  if (index === -1) {
    throw new Error('Leaf not found in the leaves array.');
  }

  const { pathElements, pathIndices, pathRoot } = tree.proof(leafElement);

  return {
    index,
    root: BigInt(pathRoot),
    siblings: pathElements.map(BigInt),
    pathIndices,
  };
}

export const mimcMerkleTreeHash: HashFunction<Element> = (left, right) =>
  String(mimcMerkleTreeHashBigInt(BigInt(left), BigInt(right)));

export const mimcMerkleTreeOptions: Required<MerkleTreeOptions> = {
  hashFunction: mimcMerkleTreeHash,
  zeroElement: MIMC_MERKLE_TREE_ZERO_VALUE,
};

export function createMimcMerkleTree(
  leaves: MimcMerkleTreeLeaf[] = [],
  options: MimcMerkleTreeOptions = {},
): MerkleTree {
  return createMimcMerkleTreeWithDefault(leaves, options, createDefaultMimcMerkleTreeSingleThreaded);
}

export async function createMimcMerkleTreeNodejsParallel(
  leaves: MimcMerkleTreeLeaf[] = [],
  options: MimcMerkleTreeOptions = {},
): Promise<MerkleTree> {
  return createMimcMerkleTreeWithDefault(leaves, options, createDefaultMimcMerkleTreeMultiThreaded);
}

export async function createMimcMerkleTreeParallel(
  leaves: MimcMerkleTreeLeaf[] = [],
  options: MimcMerkleTreeParallelOptions = {},
): Promise<MerkleTree> {
  return createMimcMerkleTreeWithDefault(leaves, options, (levels, defaultLeaves) =>
    createDefaultMimcMerkleTreeBrowserParallel(levels, defaultLeaves, options),
  );
}

export function computeMimcMerkleTreeRoot(leaves: MimcMerkleTreeLeaf[]): bigint {
  return BigInt(createMimcMerkleTree(leaves).root);
}

export async function computeMimcMerkleTreeRootParallel(
  leaves: MimcMerkleTreeLeaf[],
): Promise<bigint> {
  return BigInt((await createMimcMerkleTreeParallel(leaves)).root);
}

export function generateMimcMerkleProof(
  leavesOrTree: MimcMerkleTreeLeaf[] | MerkleTree,
  leaf: MimcMerkleTreeLeaf,
): MimcMerkleProof {
  return mimcMerkleProofFromTree(leavesOrTree instanceof MerkleTree ? leavesOrTree : createMimcMerkleTree(leavesOrTree), leaf);
}

export async function generateMimcMerkleProofParallel(
  leavesOrTree: MimcMerkleTreeLeaf[] | MerkleTree,
  leaf: MimcMerkleTreeLeaf,
): Promise<MimcMerkleProof> {
  return mimcMerkleProofFromTree(leavesOrTree instanceof MerkleTree ? leavesOrTree : await createMimcMerkleTreeParallel(leavesOrTree), leaf);
}
