import fc from 'fast-check';
import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi } from 'viem';
import {
  POLICY_MANAGER_WRITES_ABI,
  RECOVERY_ACTION_SET_ADDR_PRIVILEGE_ABI,
  SetupClient,
  type AccountFilterOptions,
  type ActionInfo,
  type ActionState,
  type Address,
  type BlockHeader,
  type BlockRange,
  type BlockTag,
  type ClientConfiguration,
  type DeploymentDescriptor,
  type FilterSpec,
  type Hex,
  type IActionCodec,
  type IEventManager,
  type IPolicyManagerInteractor,
  type IProvider,
  type IRecoveryActionArming,
  type IRecoveryActionInteractor,
  type IRecoveryMethod,
  type KitNotification,
  type LogPosition,
  type MethodRegistry,
  type MethodTier,
  type ModuleInfo,
  type Parties,
  type PinnedBlock,
  type PreparedCall,
  type ReadResult,
  type SetupDraft,
} from '../../src/index';

const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 256);

/** The property runner's parameters, the run count read from `FC_NUM_RUNS`. */
export const FC_PARAMS = { numRuns };

/** A per-test timeout that grows with the run count. */
export const TIMEOUT = Math.max(10_000, numRuns * 80);

export const ACCOUNT: Address = getAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
/** `ACCOUNT` with one letter's case flipped: mixed case whose checksum fails. */
export const ACCOUNT_BAD_CHECKSUM: Address = '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
/** The action of the `ambire-kit-slot.json` row `normal`. */
export const ACTION: Address = '0x2222222222222222222222222222222222222222';
export const OTHER_ACTION: Address = getAddress('0x00000000000000000000000000000000000ac711');
export const MANAGER: Address = getAddress(`0x${'a1'.repeat(20)}`);
export const METHOD_A: Address = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefab01');
export const METHOD_B: Address = getAddress('0xfedcbafedcbafedcbafedcbafedcbafedcbafe02');
export const METHOD_C: Address = getAddress('0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a103');
export const KEY_1: Address = getAddress('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbe04');
export const KEY_2: Address = getAddress('0xc0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec005');
export const SENDER: Address = getAddress('0xbadcafebadcafebadcafebadcafebadcafeba006');
export const ZERO_WORD: Hex = `0x${'00'.repeat(32)}`;
export const COMMITTED: Hex = `0x${'c7'.repeat(32)}`;
export const SUPPLIED_SALT: Hex = `0x${'5a'.repeat(32)}`;

/** The kit slot and binding of the `ambire-kit-slot.json` row `normal`. */
export const KIT_SLOT: Address = '0xb64cddd1b613c46e97677526c0cd0115cf105553';
export const KIT_BINDING: Hex = '0x91c0bf1b366947b9cb85e75de0b7d50a35a8d08e1cca0997e5317f30c566029f';

export const HEADER: BlockHeader = {
  number: 5_000,
  timestamp: 1_760_000_000,
  hash: `0x${'5b'.repeat(32)}`,
};

export const PIN: PinnedBlock = { number: HEADER.number, hash: HEADER.hash };

export const DESCRIPTOR: DeploymentDescriptor = {
  chainId: 11155111,
  manager: MANAGER,
  methodEcdsa: getAddress('0x000000000000000000000000000000000000e001'),
  methodPasskey: getAddress('0x000000000000000000000000000000000000e002'),
  methodAadhaar: getAddress('0x000000000000000000000000000000000000e003'),
  methodZkpassport: getAddress('0x000000000000000000000000000000000000e004'),
  action: ACTION,
  servedImplementation: getAddress('0x000000000000000000000000000000000000b001'),
  deployedAt: 100,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [METHOD_A, METHOD_B],
  auditedActions: [ACTION],
};

export const CONFIGURATION: ClientConfiguration = {
  defaultWait: 259_200,
  shortWait: 86_400,
  maxWait: 31_536_000,
  requestWindow: { default: 3_600, floor: 600 },
  cancelWindow: 3_600,
  ruleCostBound: 10_000_000,
  candidateKeys: [KEY_1, KEY_2],
  blockTags: { read: 'latest', watch: 'finalized' },
  logChunkSize: 10_000,
  tokens: [],
  simulate: true,
};

/** A draft with two credentials, the second carrying a supplied salt and the first a label. */
export const DRAFT: SetupDraft = {
  wait: 172_800,
  ignoresPause: false,
  clauses: [
    {
      threshold: 1,
      credentials: [
        { method: METHOD_A, config: `0x${'11'.repeat(20)}`, label: 'Alice' },
        { method: METHOD_B, config: '0xabcdef', salt: SUPPLIED_SALT },
      ],
    },
  ],
  privacy: { publicMetadata: '0x', backup: 'encrypted' },
};

/** A draft whose threshold exceeds its credential count, an error `validateSetup` reports. */
export const BAD_DRAFT: SetupDraft = {
  ...DRAFT,
  clauses: [{ threshold: 3, credentials: DRAFT.clauses[0]?.credentials ?? [] }],
};

/** The draft with another backup choice. */
export const withBackup = (draft: SetupDraft, backup: SetupDraft['privacy']['backup']): SetupDraft => ({
  ...draft,
  privacy: { ...draft.privacy, backup },
});

/** The configuration a draft closes over: its clauses without labels, its wait and its pause choice. */
export const configurationOf = (draft: SetupDraft) => ({
  clauses: draft.clauses.map((clause) => ({
    threshold: clause.threshold,
    credentials: clause.credentials.map(({ method, config, salt }) => (salt === undefined ? { method, config } : { method, config, salt })),
  })),
  wait: draft.wait,
  ignoresPause: draft.ignoresPause,
});

/** The default salt's preimage layout, written out here rather than imported from the package. */
const SALT_PARAMETERS = [{ type: 'address' }, { type: 'uint256' }] as const;

/** A credential commitment's preimage layout. */
const CREDENTIAL_PARAMETERS = [{ type: 'address' }, { type: 'bytes' }, { type: 'bytes32' }] as const;

/** The setup body's layout: the wait, the pause choice and the clauses. */
const BODY_PARAMETERS = [
  { type: 'uint48' },
  { type: 'bool' },
  {
    type: 'tuple[]',
    components: [
      { name: 'threshold', type: 'uint8' },
      { name: 'credentials', type: 'bytes32[]' },
    ],
  },
] as const;

/** The setup commitment's preimage layout. */
const COMMITMENT_PARAMETERS = [{ type: 'address' }, { type: 'address' }, { type: 'uint64' }, { type: 'bytes' }] as const;

/** The default salt recomputed independently: `keccak256(abi.encode(address, uint256))`. */
export const referenceSalt = (account: Address, place: number): Hex =>
  keccak256(encodeAbiParameters(SALT_PARAMETERS, [account, BigInt(place)]));

/** A credential commitment recomputed independently: `keccak256(abi.encode(address, bytes, bytes32))`. */
export const referenceCredential = (method: Address, config: Hex, salt: Hex): Hex =>
  keccak256(encodeAbiParameters(CREDENTIAL_PARAMETERS, [method, config, salt]));

/** The setup body bytes recomputed independently: `abi.encode(uint48, bool, (uint8, bytes32[])[])`. */
export const referenceBodyBytes = (wait: number, ignoresPause: boolean, clauses: readonly { threshold: number; credentials: readonly Hex[] }[]): Hex =>
  encodeAbiParameters(BODY_PARAMETERS, [
    wait,
    ignoresPause,
    clauses.map((clause) => ({ threshold: clause.threshold, credentials: [...clause.credentials] })),
  ]);

/** The setup commitment recomputed independently: `keccak256(abi.encode(address, address, uint64, bytes))`. */
export const referenceCommitmentOf = (account: Address, action: Address, nonce: bigint, body: Hex): Hex =>
  keccak256(encodeAbiParameters(COMMITMENT_PARAMETERS, [account, action, nonce, body]));

/** The commitment a draft closes over, recomputed independently with flat places and default salts. */
export function referenceCommitment(
  draft: Pick<SetupDraft, 'clauses' | 'wait' | 'ignoresPause'>,
  account: Address,
  action: Address,
  nonce: bigint,
): Hex {
  let place = 0;

  const clauses = draft.clauses.map((clause) => ({
    threshold: clause.threshold,
    credentials: clause.credentials.map((credential) => {
      const salt = credential.salt ?? referenceSalt(account, place);

      place += 1;

      return referenceCredential(credential.method, credential.config, salt);
    }),
  }));

  return referenceCommitmentOf(account, action, nonce, referenceBodyBytes(draft.wait, draft.ignoresPause, clauses));
}

/** An `Attempt` record in the given state. */
export const attemptIn = (state: ActionState['attempt']['state']): ActionState['attempt'] => ({
  attemptId: 0n,
  setupNonce: 0n,
  consumableAfter: 0,
  state,
  payloadHash: ZERO_WORD,
  order: { token: '0x0000000000000000000000000000000000000000', amount: 0n, payee: '0x0000000000000000000000000000000000000000' },
  usedMethods: [],
  ignoresPause: false,
});

/** The manager state with no setup standing and the given stored nonce. */
export const noSetupState = (setupNonce = 0n, setupCommittedAtBlock = 0): ActionState => ({
  setupCommitment: ZERO_WORD,
  setupNonce,
  nextAttemptId: 0n,
  setupCommittedAtBlock,
  attempt: attemptIn('None'),
});

/** The manager state with a setup standing. */
export const standingState = (setupCommitment: Hex, setupNonce: bigint, setupCommittedAtBlock: number): ActionState => ({
  setupCommitment,
  setupNonce,
  nextAttemptId: 1n,
  setupCommittedAtBlock,
  attempt: attemptIn('None'),
});

/** A log position with hashes derived from its numbers. */
export const position = (blockNumber: number, logIndex = 0, removed = false): LogPosition => ({
  blockNumber,
  blockHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
  logIndex,
  transactionHash: `0x${(blockNumber * 1000 + logIndex).toString(16).padStart(64, 'e')}`,
  removed,
});

/** A `setup-committed` notification. */
export const committed = (
  nonce: bigint,
  setupCommitment: Hex,
  privateMetadata: Hex,
  at: LogPosition,
  action: Address = ACTION,
): KitNotification => ({
  kind: 'setup-committed',
  account: ACCOUNT,
  action,
  nonce,
  setupCommitment,
  publicMetadata: '0x',
  privateMetadata,
  at,
});

/** A `setup-cleared` notification. */
export const cleared = (nonce: bigint, at: LogPosition, action: Address = ACTION): KitNotification => ({
  kind: 'setup-cleared',
  account: ACCOUNT,
  action,
  nonce,
  at,
});

/** `commitSetup` calldata, encoded by viem from the manager's ABI. */
export const commitSetupData = (action: Address, commitment: Hex, nonce: bigint, publicMetadata: Hex, privateMetadata: Hex): Hex =>
  encodeFunctionData({
    abi: POLICY_MANAGER_WRITES_ABI,
    functionName: 'commitSetup',
    args: [action, commitment, nonce, publicMetadata, privateMetadata],
  });

/** The manager's `clearSetup`, declared by hand from the pinned contract. */
const CLEAR_SETUP_ABI = parseAbi(['function clearSetup(address action, uint64 nonce)']);

/** `clearSetup(action, nonce)` calldata. */
export const clearSetupData = (action: Address, nonce: bigint): Hex =>
  encodeFunctionData({ abi: CLEAR_SETUP_ABI, functionName: 'clearSetup', args: [action, nonce] });

/** The account's `setAddrPrivilege(slot, priv)` calldata. */
export const privilegeData = (priv: Hex): Hex =>
  encodeFunctionData({ abi: RECOVERY_ACTION_SET_ADDR_PRIVILEGE_ABI, functionName: 'setAddrPrivilege', args: [KIT_SLOT, priv] });

export const ARMING_DATA = privilegeData(KIT_BINDING);
export const DISARMING_DATA = privilegeData(ZERO_WORD);

/** A prepared call sent by the account, unsimulated, as the parts return them. */
const accountCall = (target: Address, data: Hex, block: PinnedBlock | undefined): PreparedCall => ({
  kind: 'call',
  target,
  value: 0n,
  data,
  sender: 'account',
  block: block ?? { number: -1, hash: '0x' },
});

/** One part member the client called, with its arguments and the block it passed last. */
export type PartCall = { readonly part: 'manager' | 'action' | 'events'; readonly member: string; readonly args: readonly unknown[] };

/** An answer, or a value a read rejects with. */
export type Answer<T> = T | { readonly rejects: unknown };

const isRejection = (value: unknown): value is { readonly rejects: unknown } =>
  typeof value === 'object' && value !== null && 'rejects' in value;

const answer = async <T>(value: Answer<T>): Promise<T> => {
  if (isRejection(value)) throw value.rejects;

  return value;
};

/** One method module's three reads. */
export type ModuleAnswers = {
  readonly moduleInfo: ReadResult<ModuleInfo>;
  readonly paused: ReadResult<boolean>;
  readonly trustedParties: ReadResult<Parties>;
};

export const PARTIES: Parties = {
  admin: KEY_1,
  pendingAdmin: '0x0000000000000000000000000000000000000000',
  trustedKeys: [],
  pauseHolder: KEY_2,
  pendingPauseHolder: '0x0000000000000000000000000000000000000000',
};

export const MODULE_ANSWERS: ModuleAnswers = {
  moduleInfo: { answered: true, value: { name: 'method', version: '1.0.0', supportsInterface: true } },
  paused: { answered: true, value: false },
  trustedParties: { answered: true, value: PARTIES },
};

export const ACTION_INFO: ActionInfo = { name: 'AmbireRecoveryAction', version: '1.0.0', supportsInterface: true };

/** The chain the doubles answer from; every member may be replaced per test. */
export type World = {
  header: Answer<unknown>;
  state: Answer<ActionState>;
  authorized: Answer<boolean>;
  code: Answer<Hex>;
  supportsAccount: Answer<boolean>;
  actionInfo: Answer<ActionInfo>;
  authority: (key: Address) => Answer<boolean>;
  modules: (module: Address) => ModuleAnswers;
  /** What `fetch` answers over the bound action's filter. */
  bound: Answer<readonly KitNotification[]>;
  /** What `fetch` answers over the filter with the action topic left open. */
  allActions: Answer<readonly KitNotification[]>;
  /** What `call` answers for one simulation, by its index. */
  simulate: (to: Address, data: Hex, from: Address, index: number) => Promise<Hex>;
};

export const defaultWorld = (): World => ({
  header: HEADER,
  state: noSetupState(),
  authorized: false,
  code: '0x6080',
  supportsAccount: true,
  actionInfo: ACTION_INFO,
  authority: () => false,
  modules: () => MODULE_ANSWERS,
  bound: [],
  allActions: [],
  simulate: async () => '0x',
});

/** The filter the events double hands out for the bound action. */
export const BOUND_FILTER: FilterSpec = { address: [MANAGER], topics: [`0x${'b0'.repeat(32)}`, null, `0x${'0a'.repeat(32)}`] };
/** The filter the events double hands out with the action topic left open. */
export const ALL_ACTIONS_FILTER: FilterSpec = { address: [MANAGER], topics: [`0x${'b0'.repeat(32)}`, null, null] };

/** Everything the doubles saw, in order. */
export type Seen = {
  readonly blockTags: BlockTag[];
  readonly calls: { readonly to: Address; readonly data: Hex; readonly from: Address; readonly block: BlockTag }[];
  readonly codes: { readonly address: Address; readonly block: BlockTag }[];
  readonly parts: PartCall[];
  readonly fetches: { readonly filter: FilterSpec; readonly range: BlockRange }[];
  readonly filterOptions: (AccountFilterOptions | undefined)[];
  /** Every provider member called, in order. */
  readonly provider: string[];
};

/** A stub method implementation serving the given modules, carrying a tier where one is given. */
export const methodStub = (modules: readonly Address[], tier?: MethodTier): IRecoveryMethod => ({
    modules: () => modules,
    enrollInput: () => {
      throw new Error('not used');
    },
    configFrom: async () => {
      throw new Error('not used');
    },
    signingInput: () => {
      throw new Error('not used');
    },
    replyFrom: async () => {
      throw new Error('not used');
    },
    verify: async () => {
      throw new Error('not used');
    },
    codec: {} as IRecoveryMethod['codec'],
    deviceBinding: {} as IRecoveryMethod['deviceBinding'],
    describe: () => {
      throw new Error('not used');
    },
  vector: [],
  ...(tier === undefined ? {} : { tier }),
});

/** The registry the client is built with by default: `METHOD_A` and `METHOD_B` implemented, `METHOD_C` not. */
export const defaultRegistry = (): MethodRegistry =>
  new Map<Address, IRecoveryMethod>([
    [METHOD_A, methodStub([METHOD_A])],
    [METHOD_B, methodStub([METHOD_B])],
  ]);

/** The doubles of the provider and the three parts over one world, recording everything they are asked. */
export type Doubles = {
  readonly provider: IProvider;
  readonly manager: IPolicyManagerInteractor;
  readonly action: IRecoveryActionInteractor & IRecoveryActionArming;
  readonly events: IEventManager;
  readonly seen: Seen;
};

const unexpected = (name: string) => async (): Promise<never> => {
  throw new Error(`unexpected call to ${name}`);
};

export function doubles(world: World): Doubles {
  const seen: Seen = { blockTags: [], calls: [], codes: [], parts: [], fetches: [], filterOptions: [], provider: [] };
  const note = (part: PartCall['part'], member: string, args: readonly unknown[]): void => {
    seen.parts.push({ part, member, args });
  };

  const provider: IProvider = {
    async chainId() {
      seen.provider.push('chainId');

      return DESCRIPTOR.chainId;
    },
    async call(to, data, from, block) {
      seen.provider.push('call');
      seen.calls.push({ to, data, from, block });

      return world.simulate(to, data, from, seen.calls.length - 1);
    },
    async logs() {
      seen.provider.push('logs');

      return [];
    },
    async block(tag) {
      seen.provider.push('block');
      seen.blockTags.push(tag);

      return (await answer(world.header)) as BlockHeader;
    },
    async code(address, block) {
      seen.provider.push('code');
      seen.codes.push({ address, block });

      return answer(world.code);
    },
    async transaction() {
      seen.provider.push('transaction');

      return undefined;
    },
  };

  const manager: IPolicyManagerInteractor = {
    async prepareCommitSetup(action, setupCommitment, nonce, publicMetadata, privateMetadata, block) {
      note('manager', 'prepareCommitSetup', [action, setupCommitment, nonce, publicMetadata, privateMetadata, block]);

      return accountCall(MANAGER, commitSetupData(action, setupCommitment, nonce, publicMetadata, privateMetadata), block);
    },
    async prepareClearSetup(action, nonce, block) {
      note('manager', 'prepareClearSetup', [action, nonce, block]);

      return accountCall(MANAGER, clearSetupData(action, nonce), block);
    },
    prepareCancelByOwner: unexpected('prepareCancelByOwner'),
    prepareStartAttempt: unexpected('prepareStartAttempt'),
    prepareCancelByProofs: unexpected('prepareCancelByProofs'),
    prepareCancelByVeto: unexpected('prepareCancelByVeto'),
    async stateOf(block) {
      note('manager', 'stateOf', [block]);

      return answer(world.state);
    },
    hashApproval: unexpected('hashApproval'),
    hashCancel: unexpected('hashCancel'),
    eip712Domain: unexpected('eip712Domain'),
    name: unexpected('name'),
    version: unexpected('version'),
    supportsInterface: unexpected('supportsInterface'),
    async moduleInfo(module, block) {
      note('manager', 'moduleInfo', [module, block]);

      return world.modules(module).moduleInfo;
    },
    async paused(module, block) {
      note('manager', 'paused', [module, block]);

      return world.modules(module).paused;
    },
    async trustedParties(module, block) {
      note('manager', 'trustedParties', [module, block]);

      return world.modules(module).trustedParties;
    },
  };

  const action: IRecoveryActionInteractor & IRecoveryActionArming = {
    async supportsAccount(block) {
      note('action', 'supportsAccount', [block]);

      return answer(world.supportsAccount);
    },
    async isAuthority(key, block) {
      note('action', 'isAuthority', [key, block]);

      return answer(world.authority(key));
    },
    async isAuthorized(block) {
      note('action', 'isAuthorized', [block]);

      return answer(world.authorized);
    },
    holdsAnyPrivilege: unexpected('holdsAnyPrivilege'),
    async actionInfo(block) {
      note('action', 'actionInfo', [block]);

      return answer(world.actionInfo);
    },
    async disarmingCall(block) {
      note('action', 'disarmingCall', [block]);

      return accountCall(ACCOUNT, DISARMING_DATA, block);
    },
    async armingCall(block) {
      note('action', 'armingCall', [block]);

      return accountCall(ACCOUNT, ARMING_DATA, block);
    },
  };

  const events: IEventManager = {
    accountFilter(options) {
      seen.filterOptions.push(options);

      return options?.allActions === true ? ALL_ACTIONS_FILTER : BOUND_FILTER;
    },
    methodFilter() {
      throw new Error('unexpected call to methodFilter');
    },
    privilegeFilter() {
      throw new Error('unexpected call to privilegeFilter');
    },
    async fetch(filter, range) {
      note('events', 'fetch', [filter, range]);
      seen.fetches.push({ filter, range });

      return answer(filter === ALL_ACTIONS_FILTER ? world.allActions : world.bound);
    },
    decodeLog() {
      throw new Error('unexpected call to decodeLog');
    },
  };

  return { provider, manager, action, events, seen };
}

/** A codec stub serving the given action; a payload never decodes to a handover. */
export const codecFor = (action: Address): IActionCodec => ({
  actions: [action],
  encode: () => '0x',
  decode: () => {
    throw new Error('not a handover');
  },
});

/** What `build` may override in the client's constructor arguments. */
export type BuildOptions = {
  readonly world?: Partial<World>;
  readonly configuration?: Partial<ClientConfiguration>;
  readonly methods?: MethodRegistry;
  readonly escaped?: boolean;
  readonly account?: Address;
  readonly action?: Address;
};

/** A client over fresh doubles, with the world the doubles answer from. */
export function build(options: BuildOptions = {}): Doubles & { readonly client: SetupClient; readonly world: World } {
  const world: World = { ...defaultWorld(), ...options.world };
  const made = doubles(world);
  const configuration = { ...CONFIGURATION, ...options.configuration };
  const action = options.action ?? ACTION;
  const codec = codecFor(action);
  const client =
    options.escaped === undefined
      ? new SetupClient(
          made.provider,
          DESCRIPTOR,
          options.account ?? ACCOUNT,
          action,
          configuration,
          made.manager,
          made.action,
          made.events,
          options.methods ?? defaultRegistry(),
          codec,
        )
      : new SetupClient(
          made.provider,
          DESCRIPTOR,
          options.account ?? ACCOUNT,
          action,
          configuration,
          made.manager,
          made.action,
          made.events,
          options.methods ?? defaultRegistry(),
          codec,
          undefined,
          options.escaped,
        );

  return { ...made, client, world };
}

/** The last argument of a part call, the block it was pinned to. */
export const lastArgument = (call: PartCall): unknown => call.args[call.args.length - 1];

/** The members the client called on the parts, in order. */
export const members = (seen: Seen): string[] => seen.parts.map((call) => `${call.part}.${call.member}`);

/** The members of the parts that read or prepare against a block; `fetch` takes a range instead. */
export const pinnedPartCalls = (seen: Seen): PartCall[] => seen.parts.filter((call) => call.part !== 'events');

/** A provider revert carrying the given data. */
export const revert = (data: Hex): { readonly data: Hex } => ({ data });

/** A failure that is no revert: an unreachable node. */
export const transportFailure = (): Error => new Error('connect ECONNREFUSED');

/** An arbitrary valid draft: up to three clauses of up to three credentials over the three methods. */
export const draftArbitrary: fc.Arbitrary<SetupDraft> = fc
  .record({
    wait: fc.integer({ min: 0, max: 31_536_000 }),
    ignoresPause: fc.boolean(),
    clauses: fc.array(
      fc.array(
        fc.record({
          method: fc.constantFrom(METHOD_A, METHOD_B, METHOD_C),
          config: fc.uint8Array({ minLength: 0, maxLength: 24 }).map((bytes): Hex => `0x${Buffer.from(bytes).toString('hex')}`),
          salt: fc.option(fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes): Hex => `0x${Buffer.from(bytes).toString('hex')}`), {
            nil: undefined,
          }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
      { minLength: 1, maxLength: 3 },
    ),
  })
  .map(({ wait, ignoresPause, clauses }) => ({
    wait,
    ignoresPause,
    clauses: clauses.map((credentials, clause) => ({
      threshold: 1,
      credentials: credentials.map(({ method, config, salt }, index) => {
        const unique: Hex = `${config}${clause.toString(16).padStart(2, '0')}${index.toString(16).padStart(2, '0')}`;

        return salt === undefined ? { method, config: unique } : { method, config: unique, salt };
      }),
    })),
    privacy: { publicMetadata: '0x' as Hex, backup: 'encrypted' as const },
  }));
