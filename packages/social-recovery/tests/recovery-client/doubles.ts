import fc from 'fast-check';
import { encodeAbiParameters, getAddress, keccak256 } from 'viem';
import {
  AmbireActionCodec,
  PolicyManager,
  RecoveryClient,
  type AccountFilterOptions,
  type ActionState,
  type Address,
  type Attempt,
  type BlockHeader,
  type BlockRange,
  type BlockTag,
  type ClientConfiguration,
  type Configuration,
  type DeploymentDescriptor,
  type FilterSpec,
  type Handover,
  type Hex,
  type IEventManager,
  type IPolicyManagerInteractor,
  type IProvider,
  type IRecoveryActionInteractor,
  type ISignerRecovery,
  type KitNotification,
  type Parties,
  type PaymentOrder,
  type PinnedBlock,
  type RawTransaction,
  type ReadResult,
  type SetupBody,
} from '../../src/index';

const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 256);
const seedText = process.env['FC_SEED'];
const params: fc.Parameters<unknown> = seedText === undefined ? { numRuns } : { numRuns, seed: Number(seedText) };

/** A per-test timeout that grows with the run count, never below vitest's 5 s default. */
export const TIMEOUT = Math.max(5_000, numRuns * 20);

/** Asserts an asynchronous property under `FC_NUM_RUNS` and `FC_SEED`. */
export const runAsync = async <T>(property: fc.IAsyncProperty<T>): Promise<void> => fc.assert(property, params as fc.Parameters<T>);

export const ZERO: Address = '0x0000000000000000000000000000000000000000';
export const ZERO_WORD: Hex = `0x${'00'.repeat(32)}`;

/** Mixed-case EIP-55 spellings, so a lower-cased answer shows whether a member comes back checksummed. */
export const ACCOUNT = getAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
export const ACTION = getAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359');
export const MANAGER = getAddress('0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb');
export const METHOD_ECDSA = getAddress('0xd1220a0cf47c7b9be7a2e6ba89f429762e7b9adb');
export const METHOD_PASSKEY = getAddress(`0x${'e2'.repeat(20)}`);
export const METHOD_OTHER = getAddress(`0x${'e7'.repeat(20)}`);

/** Wallet guardians and keys, all mixed case once checksummed. */
export const GUARDIAN_A = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefab01');
export const GUARDIAN_B = getAddress('0xfedcbafedcbafedcbafedcbafedcbafedcbafe02');
export const KEY_OLD = getAddress('0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a103');
export const KEY_NEW = getAddress('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbe04');
export const KEY_OTHER = getAddress('0xc0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec005');
export const PAUSER = getAddress('0xbadcafebadcafebadcafebadcafebadcafeba006');
export const TOKEN = getAddress('0x00000000000000000000000000000000000c0de1');
export const PAYEE = getAddress('0x00000000000000000000000000000000000c0de2');

export const DESCRIPTOR: DeploymentDescriptor = {
  chainId: 11_155_111,
  manager: MANAGER,
  methodEcdsa: METHOD_ECDSA,
  methodPasskey: METHOD_PASSKEY,
  methodAadhaar: getAddress(`0x${'e3'.repeat(20)}`),
  methodZkpassport: getAddress(`0x${'e4'.repeat(20)}`),
  action: ACTION,
  servedImplementation: getAddress(`0x${'e5'.repeat(20)}`),
  deployedAt: 100,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [METHOD_ECDSA, METHOD_PASSKEY],
  auditedActions: [ACTION],
};

export const CLIENT_CONFIGURATION: ClientConfiguration = {
  defaultWait: 86_400,
  shortWait: 3_600,
  maxWait: 2_592_000,
  requestWindow: { default: 86_400, floor: 3_600 },
  cancelWindow: 7_200,
  ruleCostBound: 3_000_000,
  candidateKeys: [],
  blockTags: { read: 'finalized', watch: 'latest' },
  logChunkSize: 1_000,
  tokens: [TOKEN],
  simulate: false,
};

export const HEADER: BlockHeader = {
  number: 19_283_746,
  timestamp: 1_760_000_000,
  hash: `0x${'5a'.repeat(32)}`,
};

/** `abi.encode(address)`, a wallet guardian's config. */
const SIGNER_CONFIG_ABI = [{ type: 'address' }] as const;

/** `abi.encode(address, uint256)`, the default salt's preimage. */
const DEFAULT_SALT_ABI = [{ type: 'address' }, { type: 'uint256' }] as const;

/** `abi.encode(address, bytes, bytes32)`, a credential commitment's preimage. */
const CREDENTIAL_ABI = [{ type: 'address' }, { type: 'bytes' }, { type: 'bytes32' }] as const;

/** `abi.encode(uint48, bool, (uint8, bytes32[])[])`, the setup body. */
const SETUP_BODY_ABI = [
  { type: 'uint48' },
  { type: 'bool' },
  { type: 'tuple[]', components: [{ name: 'threshold', type: 'uint8' }, { name: 'credentials', type: 'bytes32[]' }] },
] as const;

/** `abi.encode(address, address, uint64, bytes)`, the setup commitment's preimage. */
const SETUP_COMMITMENT_ABI = [{ type: 'address' }, { type: 'address' }, { type: 'uint64' }, { type: 'bytes' }] as const;

/** `abi.encode(address)`, a wallet guardian's config, encoded with viem outside `src/`. */
export const ecdsaConfig = (guardian: Address): Hex => encodeAbiParameters(SIGNER_CONFIG_ABI, [guardian]);

/** Two clauses over three methods; guardian A sits at places 0 and 3, place 1 carries its own salt and a label. */
export const CONFIGURATION: Configuration = {
  clauses: [
    {
      threshold: 1,
      credentials: [
        { method: METHOD_ECDSA, config: ecdsaConfig(GUARDIAN_A), label: 'alice' },
        { method: METHOD_PASSKEY, config: '0x1234', salt: `0x${'aa'.repeat(32)}`, label: 'laptop' },
      ],
    },
    {
      threshold: 2,
      credentials: [
        { method: METHOD_ECDSA, config: ecdsaConfig(GUARDIAN_B) },
        { method: METHOD_ECDSA, config: ecdsaConfig(GUARDIAN_A) },
        { method: METHOD_OTHER, config: '0x' },
      ],
    },
  ],
  wait: 86_400,
  ignoresPause: false,
};

/** The default salt recomputed independently: `keccak256(abi.encode(address, uint256))`. */
export const referenceSalt = (account: Address, place: number): Hex =>
  keccak256(encodeAbiParameters(DEFAULT_SALT_ABI, [account, BigInt(place)]));

/** A credential commitment recomputed independently: `keccak256(abi.encode(address, bytes, bytes32))`. */
export const referenceCredential = (method: Address, config: Hex, salt: Hex): Hex =>
  keccak256(encodeAbiParameters(CREDENTIAL_ABI, [method, config, salt]));

/** The body a configuration commits to, places numbered across clauses. */
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
    SETUP_BODY_ABI,
    [body.wait, body.ignoresPause, body.clauses.map((clause) => ({ threshold: clause.threshold, credentials: [...clause.credentials] }))],
  );

/** The setup commitment recomputed independently: `keccak256(abi.encode(address, address, uint64, bytes))`. */
export const referenceCommitment = (account: Address, action: Address, nonce: bigint, body: Hex): Hex =>
  keccak256(encodeAbiParameters(SETUP_COMMITMENT_ABI, [account, action, nonce, body]));

/** The commitment a configuration closes over for the bound pair, recomputed independently. */
export const commitmentOf = (configuration: Configuration, nonce: bigint): Hex =>
  referenceCommitment(ACCOUNT, ACTION, nonce, referenceEncodeBody(referenceBody(configuration, ACCOUNT)));

export const SETUP_NONCE = 3n;

/** An attempt in the given state; only `Waiting` is live. */
export const attemptIn = (state: Attempt['state'], attemptId = 4n, consumableAfter = 1_760_050_000): Attempt => ({
  attemptId,
  setupNonce: SETUP_NONCE,
  consumableAfter,
  state,
  payloadHash: `0x${'77'.repeat(32)}`,
  order: { token: TOKEN, amount: 5n, payee: PAYEE },
  usedMethods: [METHOD_ECDSA],
  ignoresPause: false,
});

/** The manager reading with a standing setup for `configuration` and no attempt waiting unless one is given. */
export const stateFor = (configuration: Configuration = CONFIGURATION, attempt: Attempt = attemptIn('Consumed', 2n)): ActionState => ({
  setupCommitment: commitmentOf(configuration, SETUP_NONCE),
  setupNonce: SETUP_NONCE,
  nextAttemptId: 5n,
  setupCommittedAtBlock: 1_000,
  attempt,
});

/** A method's declared parties with the given pause holder. */
export const partiesWith = (pauseHolder: Address): Parties => ({
  admin: PAUSER,
  pendingAdmin: ZERO,
  trustedKeys: [],
  pauseHolder,
  pendingPauseHolder: ZERO,
});

export const ORDER: PaymentOrder = { token: TOKEN, amount: 1_234_567_890_123_456_789n, payee: PAYEE };

/** The handover every happy-path test passes: a named removed key `isAuthority` confirms. */
export const HANDOVER: Handover = { newAuthority: KEY_NEW, removedAuthority: KEY_OLD };

/** A transport failure a double rejects with. */
export const INJECTED = new Error('injected transport failure');

/** One member call any double received, in the order received. */
export type Seen = { readonly part: 'provider' | 'manager' | 'action' | 'events' | 'signer' | 'codec'; readonly member: string; readonly args: readonly unknown[] };

/** What every double answers; keys of the maps are lower-cased addresses. */
export type World = {
  readonly header: BlockHeader;
  readonly state: ActionState;
  readonly paused: ReadonlyMap<string, ReadResult<boolean>>;
  readonly parties: ReadonlyMap<string, ReadResult<Parties>>;
  readonly code: ReadonlyMap<string, Hex>;
  readonly authorities: ReadonlySet<string>;
  readonly privileged: ReadonlySet<string>;
  readonly notifications: readonly KitNotification[];
  readonly transactions: ReadonlyMap<string, RawTransaction | undefined>;
  /** Present: the client gets a signer recovery answering this. */
  readonly signer?: { readonly value: Address | undefined };
  /** Lower-cased keys whose `isAuthority` answers this value instead of a boolean. */
  readonly authorityAnswers?: ReadonlyMap<string, unknown>;
  /** `part.member` names whose calls reject with the value. */
  readonly failures: ReadonlyMap<string, unknown>;
  /** `part.member` names whose answers wait this many milliseconds, to reorder concurrent reads. */
  readonly delays?: ReadonlyMap<string, number>;
  /** Headers the block read answers in turn, `header` once they run out, so a second pin shows. */
  readonly headers?: readonly BlockHeader[];
};

/** The happy-path world over `CONFIGURATION`, with the given members replaced. */
export const world = (overrides: Partial<World> = {}): World => ({
  header: HEADER,
  state: stateFor(),
  paused: new Map(),
  parties: new Map(),
  code: new Map(),
  authorities: new Set([KEY_OLD.toLowerCase()]),
  privileged: new Set(),
  notifications: [],
  transactions: new Map(),
  failures: new Map(),
  ...overrides,
});

/** The filter object the events double hands out, compared by identity. */
export const ACCOUNT_FILTER: FilterSpec = { address: [MANAGER], topics: [] };

/** A codec that records every encode and decode before the shipped codec answers. */
export class SpyCodec extends AmbireActionCodec {
  readonly encoded: Handover[] = [];

  override encode(handover: Handover): Hex {
    this.encoded.push(handover);

    return super.encode(handover);
  }
}

/** A client over doubles answering from `world`, with every call recorded in `seen`. */
export type Rig = {
  readonly client: RecoveryClient;
  readonly seen: Seen[];
  readonly codec: SpyCodec;
  readonly events: IEventManager;
  readonly filterOptions: (AccountFilterOptions | undefined)[];
  /** The doubles the client was built over, for a reference computation over the same world. */
  readonly parts: {
    readonly provider: IProvider;
    readonly manager: IPolicyManagerInteractor;
    readonly action: IRecoveryActionInteractor;
    readonly signerRecovery: ISignerRecovery | undefined;
  };
};

type Ctor = ConstructorParameters<typeof RecoveryClient>;

/** What a test may put in place of the bound pair, the descriptor or the events double. */
export type RigOverrides = {
  readonly account?: Address;
  readonly action?: Address;
  readonly descriptor?: DeploymentDescriptor;
  readonly events?: IEventManager;
  /** The log every double records into, so a construction that throws still shows what it read. */
  readonly seen?: Seen[];
  /** Passed as the constructor's trailing version-escape flag when given. */
  readonly escaped?: boolean;
  /** Answers the provider's `call`, the simulation's `eth_call`; `0x` when absent. */
  readonly call?: (to: Address, data: Hex, from: Address, block: unknown) => Promise<Hex>;
};

/** Builds the client from doubles; `configuration` replaces the client configuration. */
export function rig(given: World = world(), configuration: ClientConfiguration = CLIENT_CONFIGURATION, overrides: RigOverrides = {}): Rig {
  const seen: Seen[] = overrides.seen ?? [];
  const filterOptions: (AccountFilterOptions | undefined)[] = [];
  const answer = async <T>(part: Seen['part'], member: string, args: readonly unknown[], value: () => T): Promise<T> => {
    seen.push({ part, member, args });

    const delay = given.delays?.get(`${part}.${member}`);

    if (delay !== undefined) await new Promise((resolve) => setTimeout(resolve, delay));

    const failure = given.failures.get(`${part}.${member}`);

    if (failure !== undefined) throw failure;

    return value();
  };
  let blockReads = 0;
  const unexpected = (part: Seen['part'], member: string) => async (...args: unknown[]): Promise<never> => {
    seen.push({ part, member, args });

    throw new Error(`${part}.${member} is not an init's read`);
  };
  const keyed = (address: unknown): string => String(address).toLowerCase();
  let realManager: PolicyManager | undefined;
  /** The shipped manager part encodes the prepares over the recorded provider, built on first use. */
  const delegated = (member: 'prepareCancelByOwner' | 'prepareStartAttempt' | 'prepareCancelByProofs' | 'prepareCancelByVeto') =>
    async (...args: unknown[]): Promise<unknown> => {
      seen.push({ part: 'manager', member, args });

      const failure = given.failures.get(`manager.${member}`);

      if (failure !== undefined) throw failure;

      realManager ??= new PolicyManager(provider, overrides.descriptor ?? DESCRIPTOR, overrides.account ?? ACCOUNT, overrides.action ?? ACTION, configuration.blockTags);

      return (realManager[member] as (...given: unknown[]) => Promise<unknown>)(...args);
    };

  const provider: IProvider = {
    chainId: async () => answer('provider', 'chainId', [], () => DESCRIPTOR.chainId),
    call: async (to, data, from, block) => {
      seen.push({ part: 'provider', member: 'call', args: [to, data, from, block] });

      const failure = given.failures.get('provider.call');

      if (failure !== undefined) throw failure;

      return overrides.call === undefined ? '0x' : overrides.call(to, data, from, block);
    },
    logs: async (...args) => answer('provider', 'logs', args, () => []),
    block: async (tag: BlockTag) => {
      const header = given.headers?.[blockReads] ?? given.header;

      blockReads += 1;

      return answer('provider', 'block', [tag], () => header);
    },
    code: async (address, block) => answer('provider', 'code', [address, block], () => given.code.get(keyed(address)) ?? '0x'),
    transaction: async (hash) => answer('provider', 'transaction', [hash], () => given.transactions.get(keyed(hash))),
  };

  const manager = {
    stateOf: async (block?: PinnedBlock) => answer('manager', 'stateOf', [block], () => given.state),
    paused: async (module: Address, block?: PinnedBlock) =>
      answer('manager', 'paused', [module, block], () => given.paused.get(keyed(module)) ?? { answered: true, value: false }),
    trustedParties: async (module: Address, block?: PinnedBlock) =>
      answer('manager', 'trustedParties', [module, block], () => given.parties.get(keyed(module)) ?? { answered: true, value: partiesWith(ZERO) }),
    prepareCommitSetup: unexpected('manager', 'prepareCommitSetup'),
    prepareClearSetup: unexpected('manager', 'prepareClearSetup'),
    prepareCancelByOwner: delegated('prepareCancelByOwner'),
    prepareStartAttempt: delegated('prepareStartAttempt'),
    prepareCancelByProofs: delegated('prepareCancelByProofs'),
    prepareCancelByVeto: delegated('prepareCancelByVeto'),
    hashApproval: unexpected('manager', 'hashApproval'),
    hashCancel: unexpected('manager', 'hashCancel'),
    eip712Domain: unexpected('manager', 'eip712Domain'),
    name: unexpected('manager', 'name'),
    version: unexpected('manager', 'version'),
    supportsInterface: unexpected('manager', 'supportsInterface'),
    moduleInfo: unexpected('manager', 'moduleInfo'),
  } as unknown as IPolicyManagerInteractor;

  const action = {
    isAuthority: async (key: Address, block?: PinnedBlock) => answer('action', 'isAuthority', [key, block], () =>
        (given.authorityAnswers?.has(keyed(key)) ? given.authorityAnswers.get(keyed(key)) : given.authorities.has(keyed(key))) as boolean),
    holdsAnyPrivilege: async (candidate: Address, block?: PinnedBlock) =>
      answer('action', 'holdsAnyPrivilege', [candidate, block], () => given.privileged.has(keyed(candidate))),
    supportsAccount: unexpected('action', 'supportsAccount'),
    isAuthorized: unexpected('action', 'isAuthorized'),
    actionInfo: unexpected('action', 'actionInfo'),
    disarmingCall: unexpected('action', 'disarmingCall'),
  } as unknown as IRecoveryActionInteractor;

  const doubleEvents: IEventManager = {
    accountFilter(options?: AccountFilterOptions) {
      filterOptions.push(options);

      return ACCOUNT_FILTER;
    },
    methodFilter() {
      seen.push({ part: 'events', member: 'methodFilter', args: [] });

      return { address: [], topics: [] };
    },
    privilegeFilter() {
      seen.push({ part: 'events', member: 'privilegeFilter', args: [] });

      return { address: [], topics: [] };
    },
    fetch: async (filter: FilterSpec, range: BlockRange) => answer('events', 'fetch', [filter, { ...range }], () => given.notifications),
    decodeLog(log) {
      seen.push({ part: 'events', member: 'decodeLog', args: [log] });

      return undefined;
    },
  };

  const signerRecovery: ISignerRecovery | undefined =
    given.signer === undefined
      ? undefined
      : {
          recoverSigner: async (transaction: RawTransaction, account: Address) =>
            answer('signer', 'recoverSigner', [transaction, account], () => given.signer?.value),
        };

  const events = overrides.events ?? doubleEvents;
  const codec = new SpyCodec([overrides.action ?? ACTION]);
  const client = new RecoveryClient(
    provider as Ctor[0],
    (overrides.descriptor ?? DESCRIPTOR) as Ctor[1],
    (overrides.account ?? ACCOUNT) as Ctor[2],
    (overrides.action ?? ACTION) as Ctor[3],
    configuration as Ctor[4],
    manager as Ctor[5],
    action as Ctor[6],
    events as Ctor[7],
    new Map() as Ctor[8],
    codec as Ctor[9],
    signerRecovery as Ctor[10],
    ...((overrides.escaped === undefined ? [] : [overrides.escaped]) as []),
  );

  return { client, seen, codec, events, filterOptions, parts: { provider, manager, action, signerRecovery } };
}

/** The calls to one member, in order. */
export const callsTo = (seen: readonly Seen[], part: Seen['part'], member: string): Seen[] =>
  seen.filter((one) => one.part === part && one.member === member);

/** The block a part call received as its last argument. */
export const lastArg = (one: Seen): unknown => one.args[one.args.length - 1];

/** The pinned block the header names. */
export const pinnedOf = (header: BlockHeader): PinnedBlock => ({ number: header.number, hash: header.hash });

/** The rejection of a promise, failing loudly where it resolves. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (thrown) {
    return thrown;
  }

  throw new Error('expected a rejection');
}

/** The error codes a thrown refusal's findings carry. */
export const errorCodes = (thrown: unknown): string[] =>
  ((thrown as { findings?: { errors?: readonly { code: string }[] } }).findings?.errors ?? []).map((finding) => finding.code);
