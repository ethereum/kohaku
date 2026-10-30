import { encodeAbiParameters, getAddress } from 'viem';
import type {
  AccountFilterOptions,
  Address,
  BlockRange,
  DeploymentDescriptor,
  FilterSpec,
  Handover,
  Hex,
  IActionCodec,
  KitNotification,
  LogPosition,
  PinnedBlock,
  RawTransaction,
  RemovedKeyInputs,
} from '../../src/index';

/** One read the inference made, in the order it made them. */
export type Read =
  | { readonly kind: 'isAuthority'; readonly key: Address; readonly block: PinnedBlock | undefined }
  | { readonly kind: 'fetch'; readonly filter: FilterSpec; readonly range: BlockRange }
  | { readonly kind: 'transaction'; readonly hash: Hex }
  | { readonly kind: 'recoverSigner'; readonly transaction: RawTransaction; readonly account: Address };

export const ACCOUNT = getAddress('0x00000000000000000000000000000000000acc01');
export const ACTION = getAddress('0x00000000000000000000000000000000000ac710');
export const OTHER_ACCOUNT = getAddress('0x00000000000000000000000000000000000acc02');
export const OTHER_ACTION = getAddress('0x00000000000000000000000000000000000ac711');
export const ZERO: Address = '0x0000000000000000000000000000000000000000';

/** Keys whose checksummed spelling is mixed case, so a lower-cased answer shows whether the result is checksummed. */
export const KEYS: readonly Address[] = [
  getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefab01'),
  getAddress('0xfedcbafedcbafedcbafedcbafedcbafedcbafe02'),
  getAddress('0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a103'),
  getAddress('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbe04'),
  getAddress('0xc0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec005'),
  getAddress('0xbadcafebadcafebadcafebadcafebadcafeba006'),
];

/** The key at an index of `KEYS`, failing loudly on a wrong index. */
export const key = (index: number): Address => {
  const found = KEYS[index];

  if (found === undefined) throw new Error(`no key ${index}`);

  return found;
};

export const BLOCK: PinnedBlock = { number: 500, hash: `0x${'5b'.repeat(32)}` };

export const DESCRIPTOR: DeploymentDescriptor = {
  chainId: 11155111,
  manager: getAddress(`0x${'a1'.repeat(20)}`),
  methodEcdsa: getAddress('0x000000000000000000000000000000000000e001'),
  methodPasskey: getAddress('0x000000000000000000000000000000000000e002'),
  methodAadhaar: getAddress('0x000000000000000000000000000000000000e003'),
  methodZkpassport: getAddress('0x000000000000000000000000000000000000e004'),
  action: ACTION,
  servedImplementation: getAddress('0x000000000000000000000000000000000000b001'),
  deployedAt: 100,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [],
  auditedActions: [ACTION],
};

/** `abi.encode(address, address)`, the handover layout, encoded by viem outside `src/`. */
export const handoverPayload = (newAuthority: Address, removedAuthority: Address): Hex =>
  encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [newAuthority, removedAuthority]);

/** A payload no handover codec decodes. */
export const FOREIGN_PAYLOAD: Hex = '0xabcdef';

const word = (value: number, tag: string): Hex => `0x${tag}${value.toString(16).padStart(64 - tag.length, '0')}`;

/** Where a notification sits; the block and transaction hashes follow from the numbers. */
export type Place = { readonly block: number; readonly index?: number; readonly removed?: boolean };

/** The log position of a place, with hashes derived from its numbers. */
export const positionAt = (place: Place): LogPosition => {
  const logIndex = place.index ?? 0;

  return {
    blockNumber: place.block,
    blockHash: word(place.block, 'b'),
    logIndex,
    transactionHash: word(place.block * 1000 + logIndex, 'c'),
    removed: place.removed ?? false,
  };
};

/** The bound pair, or another pair a notification is about. */
export type Pair = { readonly account?: Address; readonly action?: Address };

/** An `AttemptStarted` notification for the bound pair unless another is named. */
export const started = (attemptId: number, payload: Hex, place: Place, pair: Pair = {}): KitNotification => ({
  kind: 'attempt-started',
  account: pair.account ?? ACCOUNT,
  action: pair.action ?? ACTION,
  attemptId: BigInt(attemptId),
  setupNonce: 1n,
  setupBody: '0x',
  usedPlaces: [],
  usedMethods: [],
  payload,
  order: { token: ZERO, amount: 0n, payee: ZERO },
  consumableAfter: 0,
  at: positionAt(place),
});

/** An `AttemptConsumed` notification for the bound pair unless another is named. */
export const consumed = (attemptId: number, place: Place, pair: Pair = {}): KitNotification => ({
  kind: 'attempt-consumed',
  account: pair.account ?? ACCOUNT,
  action: pair.action ?? ACTION,
  attemptId: BigInt(attemptId),
  at: positionAt(place),
});

/** An `AttemptCancelled` notification for the bound pair. */
export const cancelled = (attemptId: number, place: Place): KitNotification => ({
  kind: 'attempt-cancelled',
  account: ACCOUNT,
  action: ACTION,
  attemptId: BigInt(attemptId),
  canceller: ACCOUNT,
  vetoingMethod: ZERO,
  cancelledBy: 'cancelByOwner',
  setupNonce: 1n,
  usedPlaces: [],
  at: positionAt(place),
});

/** A `SetupCommitted` notification for the bound pair unless another is named. */
export const committed = (place: Place, pair: Pair = {}): KitNotification => ({
  kind: 'setup-committed',
  account: pair.account ?? ACCOUNT,
  action: pair.action ?? ACTION,
  nonce: 1n,
  setupCommitment: `0x${'00'.repeat(32)}`,
  publicMetadata: '0x',
  privateMetadata: '0x',
  at: positionAt(place),
});

/** The transaction a node answers for the log at a position. */
export const transactionAt = (at: LogPosition, from: Address = KEYS[5] as Address): RawTransaction => ({
  hash: at.transactionHash,
  from,
  to: ACCOUNT,
  input: '0x1234',
  blockNumber: at.blockNumber,
  blockHash: at.blockHash,
});

/** The filter object the event manager double hands out, compared by identity. */
export const ACCOUNT_FILTER: FilterSpec = { address: [DESCRIPTOR.manager], topics: [] };

/** How a double answers: a value, or a rejection with the given reason. */
export type Outcome<T> = { readonly value: T } | { readonly rejects: unknown };

/** What each double answers; every read is recorded in `reads` before it is answered. */
export type World = {
  readonly notifications: Outcome<readonly KitNotification[]>;
  /** Lower-cased keys `isAuthority` confirms; a key in `rejects` rejects instead. */
  readonly authorities: ReadonlySet<string>;
  readonly authorityRejects?: ReadonlyMap<string, unknown>;
  /** Lower-cased hash to the node's answer. */
  readonly transactions?: ReadonlyMap<string, Outcome<RawTransaction | undefined>>;
  readonly signer?: Outcome<Address | undefined>;
  /** Fails the read at this index of the read sequence, as a transport would. */
  readonly failAt?: number;
};

/** The doubles behind one call and the reads they recorded. */
export type Rig = {
  readonly inputs: RemovedKeyInputs;
  readonly reads: Read[];
  readonly filterOptions: (AccountFilterOptions | undefined)[];
};

/** A transport error the failure injection rejects with. */
export const INJECTED = new Error('injected transport failure');

const answer = async <T>(outcome: Outcome<T>): Promise<T> => {
  if ('rejects' in outcome) throw outcome.rejects;

  return outcome.value;
};

/** Doubles for every part the inference reads, answering from `world` and recording each read. */
export const rig = (world: World, overrides: Partial<RemovedKeyInputs> = {}, codec?: IActionCodec): Rig => {
  const reads: Read[] = [];
  const filterOptions: (AccountFilterOptions | undefined)[] = [];
  const record = (read: Read): void => {
    reads.push(read);

    if (world.failAt === reads.length - 1) throw INJECTED;
  };

  const inputs: RemovedKeyInputs = {
    events: {
      accountFilter: (...args: [AccountFilterOptions?]) => {
        filterOptions.push(args[0]);

        return ACCOUNT_FILTER;
      },
      fetch: async (filter, range) => {
        record({ kind: 'fetch', filter, range: { ...range } });

        return answer(world.notifications);
      },
    },
    action: {
      isAuthority: async (candidate, block) => {
        record({ kind: 'isAuthority', key: candidate, block });

        const reason = world.authorityRejects?.get(candidate.toLowerCase());

        if (reason !== undefined) throw reason;

        return world.authorities.has(candidate.toLowerCase());
      },
    },
    codec: codec ?? tableCodec(new Map()),
    provider: {
      transaction: async (hash) => {
        record({ kind: 'transaction', hash });

        return answer(world.transactions?.get(hash.toLowerCase()) ?? { value: undefined });
      },
    },
    ...(world.signer === undefined
      ? {}
      : {
          signerRecovery: {
            recoverSigner: async (transaction: RawTransaction, account: Address) => {
              record({ kind: 'recoverSigner', transaction, account });

              return answer(world.signer as Outcome<Address | undefined>);
            },
          },
        }),
    descriptor: DESCRIPTOR,
    account: ACCOUNT,
    actionAddress: ACTION,
    ...overrides,
  };

  return { inputs, reads, filterOptions };
};

/** A codec double serving the bound action, decoding from a table and throwing on any other payload. */
export const tableCodec = (table: ReadonlyMap<string, Handover>, failure: unknown = new RangeError('not a handover')): IActionCodec => ({
  actions: [ACTION],
  encode: () => {
    throw new Error('encode is not the inference\'s');
  },
  decode: (payload) => {
    const found = table.get(payload.toLowerCase());

    if (found === undefined) throw failure;

    return found;
  },
});

/** The kinds of the recorded reads, in order. */
export const kinds = (reads: readonly Read[]): string[] => reads.map((read) => read.kind);

/** The keys `isAuthority` was asked about, lower-cased, in order. */
export const askedKeys = (reads: readonly Read[]): string[] =>
  reads.flatMap((read) => (read.kind === 'isAuthority' ? [read.key.toLowerCase()] : []));

/** A set of lower-cased keys. */
export const keySet = (...addresses: readonly Address[]): ReadonlySet<string> => new Set(addresses.map((one) => one.toLowerCase()));

/** The transactions a node knows, one per committed notification, keyed by lower-cased hash. */
export const nodeFor = (notifications: readonly KitNotification[]): ReadonlyMap<string, Outcome<RawTransaction | undefined>> =>
  new Map(
    notifications
      .filter((one) => one.kind === 'setup-committed')
      .map((one) => [one.at.transactionHash.toLowerCase(), { value: transactionAt(one.at) }] as const),
  );
