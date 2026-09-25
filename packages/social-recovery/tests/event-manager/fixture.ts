import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbi,
  toEventSelector,
  type Abi,
  type AbiEvent,
  type AbiParameter,
} from 'viem';
import {
  EventManager,
  type Address,
  type BlockRange,
  type BlockTag,
  type DeploymentDescriptor,
  type FilterSpec,
  type Hex,
  type IProvider,
  type IRecoveryMethod,
  type RawLog,
} from '../../src/index';

/** The fourteen events as Solidity signatures parsed by viem, written independently of `src/`. */
export const DERIVED_ABI = parseAbi([
  'struct PaymentOrder { address token; uint256 amount; address payee; }',
  'event SetupCommitted(address indexed account, address indexed action, uint64 nonce, bytes32 setupCommitment, bytes publicMetadata, bytes privateMetadata)',
  'event SetupCleared(address indexed account, address indexed action, uint64 nonce)',
  'event AttemptStarted(address indexed account, address indexed action, uint64 attemptId, uint64 setupNonce, bytes setupBody, uint256[] usedPlaces, address[] usedMethods, bytes payload, PaymentOrder order, uint48 consumableAfter)',
  'event AttemptCancelled(address indexed account, address indexed action, uint64 attemptId, address canceller, address vetoingMethod, uint64 setupNonce, uint256[] usedPlaces)',
  'event AttemptConsumed(address indexed account, address indexed action, uint64 attemptId)',
  'event Paused(address account)',
  'event Unpaused(address account)',
  'event TrustedKeysUpdated(bytes32[] previous, bytes32[] current)',
  'event AdminRenounced(address previous)',
  'event AdminTransferOffered(address indexed current, address indexed pending)',
  'event AdminTransferred(address indexed previous, address indexed current)',
  'event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)',
  'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
  'event LogPrivilegeChanged(address indexed addr, bytes32 priv)',
]);

export type EventName = (typeof DERIVED_ABI)[number]['name'];

/** topic0 of each event, computed independently with keccak256(toBytes(signature)) and written out. */
export const TOPIC0: Readonly<Record<EventName, Hex>> = {
  SetupCommitted: '0xaeb15cc9c82c4d7d6df3ced95db4e99bbacbed41b3ce443a54ce68b99ac114fe',
  SetupCleared: '0xb8d8dfdb5d45b269a7f4e17cac990bb8661b22a107bcdc77af7333f9c9a6bea7',
  AttemptStarted: '0x4ed855be63c826e3721ab8a6c06351c3bd52393b7574cd97c1e8e4c3867f993f',
  AttemptCancelled: '0x67723650c28439c4815126f12c3e709e77c5519df4027aed5f28f42254450ad2',
  AttemptConsumed: '0xae8ab0bfab885359b2adc111f975398137ede4b5f680a44ea1e0d2ba6ca86401',
  Paused: '0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258',
  Unpaused: '0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa',
  TrustedKeysUpdated: '0xfd5b7f31ebffc5222d046eb41d71e896fa90a27fdbb47b1c9e62ef6f2474c0fa',
  AdminRenounced: '0x3aeb34a9cebce3c91879dc662fedfe0060c966cfcefb6985a595d1c0c56b8fca',
  AdminTransferOffered: '0xe94b9e41e50bcdc50e6e53fd54e8da7146a509e28358f40e15d0d7938ccd8464',
  AdminTransferred: '0xf8ccb027dfcd135e000e9d45e6cc2d662578a8825d4c45b5e32e0adf67e79ec6',
  OwnershipTransferStarted: '0x38d16b8cac22d99fc7c124b9cd0de2d3fa1faef420bfe791d8c362d765e22700',
  OwnershipTransferred: '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0',
  LogPrivilegeChanged: '0x08ac40e0195c5998554e98853c23964a13a24309e127b2d016e8ec4adecf5e83',
};

export const MANAGER_EVENT_NAMES = [
  'SetupCommitted',
  'SetupCleared',
  'AttemptStarted',
  'AttemptCancelled',
  'AttemptConsumed',
] as const satisfies readonly EventName[];

export const METHOD_EVENT_NAMES = [
  'Paused',
  'Unpaused',
  'TrustedKeysUpdated',
  'AdminRenounced',
  'AdminTransferOffered',
  'AdminTransferred',
  'OwnershipTransferStarted',
  'OwnershipTransferred',
] as const satisfies readonly EventName[];

/** The derived ABI's entry for one event. */
export const eventOf = (name: EventName): AbiEvent => {
  const found = DERIVED_ABI.find((item): item is (typeof DERIVED_ABI)[number] => item.name === name);

  if (found === undefined) throw new Error(`no derived event ${name}`);

  return found;
};

/** The topic0 viem computes from the derived ABI's entry for one event. */
export const selectorOf = (name: EventName): Hex => toEventSelector(eventOf(name));

export const MANAGER = getAddress(`0x${'a1'.repeat(20)}`);
export const ACCOUNT = getAddress('0x00000000000000000000000000000000000acc01');
export const ACTION = getAddress('0x00000000000000000000000000000000000ac710');
export const METHOD_ECDSA = getAddress('0x000000000000000000000000000000000000e001');
export const METHOD_PASSKEY = getAddress('0x000000000000000000000000000000000000e002');
export const METHOD_AADHAAR = getAddress('0x000000000000000000000000000000000000e003');
export const METHOD_ZKPASSPORT = getAddress('0x000000000000000000000000000000000000e004');
export const SHIPPED_EXTRA = getAddress('0x000000000000000000000000000000000000e005');
export const REGISTERED_MODULE = getAddress('0x000000000000000000000000000000000000f001');
export const STRANGER = getAddress('0x5742a0e000000000000000000000000000000bad');
export const ZERO: Address = '0x0000000000000000000000000000000000000000';

export const DESCRIPTOR: DeploymentDescriptor = {
  chainId: 11155111,
  manager: MANAGER,
  methodEcdsa: METHOD_ECDSA,
  methodPasskey: METHOD_PASSKEY,
  methodAadhaar: METHOD_AADHAAR,
  methodZkpassport: METHOD_ZKPASSPORT,
  action: ACTION,
  servedImplementation: getAddress('0x000000000000000000000000000000000000b001'),
  deployedAt: 100,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [METHOD_ECDSA, METHOD_PASSKEY, SHIPPED_EXTRA],
  auditedActions: [ACTION],
};

/** A registry value no test expects the reader to call; only its key matters. */
const UNUSED_IMPLEMENTATION = {} as unknown as IRecoveryMethod;

export const REGISTRY: ReadonlyMap<Address, IRecoveryMethod> = new Map([[REGISTERED_MODULE, UNUSED_IMPLEMENTATION]]);

/** An `IProvider` that records each `logs` and `code` call it receives. */
export type ProviderDouble = IProvider & {
  readonly calls: { filter: FilterSpec; range: BlockRange }[];
  readonly codeCalls: { address: Address; block: BlockTag }[];
};

/** A provider double for a reader that should only read logs: every other read rejects or is recorded. */
export const providerDouble = (
  answer: (range: BlockRange, filter: FilterSpec) => Promise<readonly RawLog[]> = async () => [],
): ProviderDouble => {
  const calls: { filter: FilterSpec; range: BlockRange }[] = [];
  const codeCalls: { address: Address; block: BlockTag }[] = [];

  return {
    calls,
    codeCalls,
    chainId: () => Promise.reject(new Error('chainId is not the reader\'s')),
    call: () => Promise.reject(new Error('call is not the reader\'s')),
    block: () => Promise.reject(new Error('block is not the reader\'s')),
    logs: (filter, range) => {
      calls.push({ filter, range: { ...range } });

      return answer(range, filter);
    },
    code: (address, block) => {
      codeCalls.push({ address, block });

      return Promise.resolve('0x');
    },
  };
};

/** The reader under test, bound to the fixture's descriptor, account and action. */
export const makeReader = (
  provider: IProvider = providerDouble(),
  logChunkSize = 1000,
  registry: ReadonlyMap<Address, IRecoveryMethod> = REGISTRY,
): EventManager => new EventManager(provider, DESCRIPTOR, ACCOUNT, ACTION, registry, { logChunkSize });

export type LogPlace = { readonly blockNumber?: number; readonly logIndex?: number; readonly removed?: boolean };

const word = (value: number, tag: string): Hex => `0x${tag}${value.toString(16).padStart(64 - tag.length, '0')}`;

/** A raw log from `address` carrying the given topics and data, at a position. */
export const rawLog = (address: Address, topics: readonly Hex[], data: Hex, place: LogPlace = {}): RawLog => {
  const blockNumber = place.blockNumber ?? 1234;
  const logIndex = place.logIndex ?? 0;

  return {
    address,
    topics,
    data,
    blockNumber,
    blockHash: word(blockNumber, 'b'),
    logIndex,
    transactionHash: word(blockNumber * 1000 + logIndex, 'c'),
    ...(place.removed === undefined ? {} : { removed: place.removed }),
  };
};

/** Topics and data for one event, encoded by viem from the derived ABI. */
export const encodeEvent = (name: EventName, args: Readonly<Record<string, unknown>>): { topics: Hex[]; data: Hex } => {
  const event = eventOf(name);
  const topics = encodeEventTopics({ abi: [event] as Abi, eventName: name, args } as never) as unknown[];
  const unindexed: AbiParameter[] = event.inputs.filter((input) => input.indexed !== true);
  const values = unindexed.map((input) => {
    if (input.name === undefined || !(input.name in args)) throw new Error(`${name}: missing ${String(input.name)}`);

    return args[input.name];
  });

  return {
    topics: topics.map((topic) => {
      if (typeof topic !== 'string') throw new Error(`${name}: an indexed argument was left open`);

      return topic as Hex;
    }),
    data: encodeAbiParameters(unindexed, values),
  };
};

/** A log of one event emitted by `address`, built from the derived ABI. */
export const eventLog = (
  address: Address,
  name: EventName,
  args: Readonly<Record<string, unknown>>,
  place: LogPlace = {},
): RawLog => {
  const { topics, data } = encodeEvent(name, args);

  return rawLog(address, topics, data, place);
};

/** Every 0x string lowercased, deeply, so address spelling never decides a comparison. */
export const lower = (value: unknown): unknown => {
  if (typeof value === 'string') return value.startsWith('0x') ? value.toLowerCase() : value;

  if (Array.isArray(value)) return value.map(lower);

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, lower(inner)]));
  }

  return value;
};

/** An address as the 32-byte topic an indexed address fills, lowercase. */
export const addressTopic = (address: Address): Hex => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
