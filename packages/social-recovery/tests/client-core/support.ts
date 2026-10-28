import fc from 'fast-check';
import { encodeAbiParameters, getAddress, keccak256 } from 'viem';
import type {
  AccountFilterOptions,
  ActionState,
  Address,
  BlockHeader,
  BlockRange,
  BlockTag,
  Configuration,
  FilterSpec,
  Hex,
  IEventManager,
  IProvider,
  KitNotification,
  LogPosition,
  PinnedBlock,
  RawLog,
  SetupBody,
} from '../../src/index';

const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 256);
const seedText = process.env['FC_SEED'];
const params: fc.Parameters<unknown> = seedText === undefined ? { numRuns } : { numRuns, seed: Number(seedText) };

/** A per-test timeout that grows with the run count, never below vitest's 5 s default. */
export const TIMEOUT = Math.max(5_000, numRuns * 20);

/** Asserts a synchronous property under `FC_NUM_RUNS` and `FC_SEED`. */
export const run = <T>(property: fc.IProperty<T>): void => fc.assert(property, params as fc.Parameters<T>);

/** Asserts an asynchronous property under `FC_NUM_RUNS` and `FC_SEED`. */
export const runAsync = async <T>(property: fc.IAsyncProperty<T>): Promise<void> =>
  fc.assert(property, params as fc.Parameters<T>);

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
export const ZERO_WORD: Hex = `0x${'00'.repeat(32)}`;

export const ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
export const ACTION: Address = '0x2222222222222222222222222222222222222222';
/** An EIP-55 spelling with mixed case, so the address rule is exercised. */
export const ACCOUNT_MIXED: Address = getAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
/** `ACCOUNT_MIXED` with one letter's case flipped, a mixed-case spelling whose checksum fails. */
export const ACCOUNT_BAD_CHECKSUM: Address = '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
export const MANAGER: Address = getAddress(`0x${'a1'.repeat(20)}`);
export const METHOD_A: Address = '0x3333333333333333333333333333333333333333';
export const METHOD_B: Address = '0x4444444444444444444444444444444444444444';
export const SENDER: Address = '0x5555555555555555555555555555555555555555';

export const HEADER: BlockHeader = {
  number: 19_283_746,
  timestamp: 1_760_000_000,
  hash: '0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a',
};

export const BLOCK: PinnedBlock = { number: HEADER.number, hash: HEADER.hash };

const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`;

export const bytesN = (n: number): fc.Arbitrary<Hex> => fc.uint8Array({ minLength: n, maxLength: n }).map(toHex);
export const anyBytes = (maxLength = 64): fc.Arbitrary<Hex> => fc.uint8Array({ maxLength }).map(toHex);
export const anyAddress: fc.Arbitrary<Address> = bytesN(20);

/** The default salt recomputed independently of the package: `keccak256(abi.encode(address, uint256))`. */
export const referenceSalt = (account: Address, place: number): Hex =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [account, BigInt(place)]));

/** A credential commitment recomputed independently: `keccak256(abi.encode(address, bytes, bytes32))`. */
export const referenceCredential = (method: Address, config: Hex, salt: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }, { type: 'bytes32' }], [method, config, salt]));

/** The body a configuration commits to, recomputed independently with flat places across clauses. */
export function referenceBody(configuration: Configuration, account: Address): SetupBody {
  let place = 0;

  const clauses = configuration.clauses.map((clause) => ({
    threshold: clause.threshold,
    credentials: clause.credentials.map((credential) => {
      const salt = credential.salt ?? referenceSalt(account, place);

      place += 1;

      return referenceCredential(credential.method, credential.config, salt);
    }),
  }));

  return { wait: configuration.wait, ignoresPause: configuration.ignoresPause, clauses };
}

/** The body bytes recomputed independently: `abi.encode(uint48, bool, (uint8, bytes32[])[])`. */
export const referenceEncodeBody = (body: SetupBody): Hex =>
  encodeAbiParameters(
    [
      { type: 'uint48' },
      { type: 'bool' },
      {
        type: 'tuple[]',
        components: [
          { name: 'threshold', type: 'uint8' },
          { name: 'credentials', type: 'bytes32[]' },
        ],
      },
    ],
    [
      body.wait,
      body.ignoresPause,
      body.clauses.map((clause) => ({ threshold: clause.threshold, credentials: [...clause.credentials] })),
    ],
  );

/** The setup commitment recomputed independently: `keccak256(abi.encode(address, address, uint64, bytes))`. */
export const referenceCommitment = (account: Address, action: Address, nonce: bigint, body: Hex): Hex =>
  keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint64' }, { type: 'bytes' }], [account, action, nonce, body]),
  );

/** The commitment a configuration closes over, recomputed independently of the package. */
export const referenceConfigurationCommitment = (
  configuration: Configuration,
  account: Address,
  action: Address,
  nonce: bigint,
): Hex => referenceCommitment(account, action, nonce, referenceEncodeBody(referenceBody(configuration, account)));

/** One provider call the double received. */
export type SeenCall = { readonly to: Address; readonly data: Hex; readonly from: Address; readonly block: BlockTag };

/** A provider double that records every member it serves and answers through the given handlers. */
export type ProviderDouble = {
  readonly provider: IProvider;
  readonly calls: SeenCall[];
  readonly blockTags: BlockTag[];
  readonly others: string[];
};

/** What `call` does for one received call: resolve with bytes, or throw the value. */
export type CallHandler = (seen: SeenCall, index: number) => Promise<Hex>;

/** A provider double; `block` answers `header` (or the handler), `call` the handler, every other member is recorded. */
export function providerDouble(
  callHandler: CallHandler = async () => '0x',
  blockAnswer: (tag: BlockTag) => Promise<unknown> = async () => HEADER,
): ProviderDouble {
  const calls: SeenCall[] = [];
  const blockTags: BlockTag[] = [];
  const others: string[] = [];

  const provider: IProvider = {
    async chainId() {
      others.push('chainId');

      return 1;
    },
    async call(to, data, from, block) {
      const seen = { to, data, from, block };

      calls.push(seen);

      return callHandler(seen, calls.length - 1);
    },
    async logs() {
      others.push('logs');

      return [];
    },
    async block(tag) {
      blockTags.push(tag);

      return (await blockAnswer(tag)) as BlockHeader;
    },
    async code() {
      others.push('code');

      return '0x';
    },
    async transaction() {
      others.push('transaction');

      return undefined;
    },
  };

  return { provider, calls, blockTags, others };
}

/** The filter the event-manager double hands out, so a test can tell it was the one passed to `fetch`. */
export const ACCOUNT_FILTER: FilterSpec = { address: [MANAGER], topics: [`0x${'ab'.repeat(32)}`] };

/** One `fetch` the double received. */
export type SeenFetch = { readonly filter: FilterSpec; readonly range: BlockRange };

/** An `IEventManager` double whose `fetch` answers the given notifications or rejects with the given value. */
export type EventsDouble = {
  readonly events: IEventManager;
  readonly fetches: SeenFetch[];
  readonly filterOptions: (AccountFilterOptions | undefined)[];
  readonly others: string[];
};

export function eventsDouble(answer: readonly KitNotification[] | { readonly rejects: unknown } = []): EventsDouble {
  const fetches: SeenFetch[] = [];
  const filterOptions: (AccountFilterOptions | undefined)[] = [];
  const others: string[] = [];

  const events: IEventManager = {
    accountFilter(options) {
      filterOptions.push(options);

      return ACCOUNT_FILTER;
    },
    methodFilter() {
      others.push('methodFilter');

      return { address: [], topics: [] };
    },
    privilegeFilter() {
      others.push('privilegeFilter');

      return { address: [], topics: [] };
    },
    async fetch(filter, range) {
      fetches.push({ filter, range });

      if ('rejects' in answer) throw answer.rejects;

      return answer;
    },
    decodeLog(log: RawLog) {
      others.push(`decodeLog ${log.transactionHash}`);

      return undefined;
    },
  };

  return { events, fetches, filterOptions, others };
}

/** A log position at the given block and index. */
export const position = (blockNumber: number, logIndex = 0, removed = false): LogPosition => ({
  blockNumber,
  blockHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
  logIndex,
  transactionHash: `0x${(blockNumber * 1000 + logIndex).toString(16).padStart(64, '0')}`,
  removed,
});

/** A `setup-committed` notification of the bound account and action. */
export const committed = (
  nonce: bigint,
  setupCommitment: Hex,
  privateMetadata: Hex,
  at: LogPosition = position(100),
): KitNotification => ({
  kind: 'setup-committed',
  account: ACCOUNT,
  action: ACTION,
  nonce,
  setupCommitment,
  publicMetadata: '0x',
  privateMetadata,
  at,
});

/** A `setup-cleared` notification of the bound account and action. */
export const cleared = (nonce: bigint, at: LogPosition = position(100)): KitNotification => ({
  kind: 'setup-cleared',
  account: ACCOUNT,
  action: ACTION,
  nonce,
  at,
});

/** An idle attempt, the part of `ActionState` a restore never reads. */
const IDLE_ATTEMPT: ActionState['attempt'] = {
  attemptId: 0n,
  setupNonce: 0n,
  consumableAfter: 0,
  state: 'None',
  payloadHash: ZERO_WORD,
  order: { token: ZERO_ADDRESS, amount: 0n, payee: ZERO_ADDRESS },
  usedMethods: [],
  ignoresPause: false,
};

/** A manager reading with a standing setup unless the commitment given is the zero word. */
export const actionState = (setupCommitment: Hex, setupNonce: bigint, setupCommittedAtBlock = 100): ActionState => ({
  setupCommitment,
  setupNonce,
  nextAttemptId: 0n,
  setupCommittedAtBlock,
  attempt: IDLE_ATTEMPT,
});

/** A one-clause configuration over the two test methods, the first salted, the second on its default salt. */
export const CONFIGURATION: Configuration = {
  clauses: [
    {
      threshold: 1,
      credentials: [
        { method: METHOD_A, config: '0x1234', salt: `0x${'aa'.repeat(32)}` },
        { method: METHOD_B, config: '0xbeef' },
      ],
    },
    { threshold: 1, credentials: [{ method: METHOD_B, config: '0x' }] },
  ],
  wait: 86_400,
  ignoresPause: false,
};
