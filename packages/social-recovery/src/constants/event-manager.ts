import { toEventSelector, type AbiEvent } from 'viem';
import type { OwnedEvent } from '../types';

/** An address event input, its name and indexing kept as literals so the decoders stay typed. */
const address = <const Name extends string, const Indexed extends boolean>(name: Name, indexed: Indexed) =>
  ({ name, type: 'address', indexed }) as const;

/** The recovery manager's events, written by hand from its Solidity declarations. */
export const MANAGER_EVENTS_ABI = [
  {
    type: 'event',
    name: 'SetupCommitted',
    inputs: [
      address('account', true),
      address('action', true),
      { name: 'nonce', type: 'uint64', indexed: false },
      { name: 'setupCommitment', type: 'bytes32', indexed: false },
      { name: 'publicMetadata', type: 'bytes', indexed: false },
      { name: 'privateMetadata', type: 'bytes', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SetupCleared',
    inputs: [address('account', true), address('action', true), { name: 'nonce', type: 'uint64', indexed: false }],
  },
  {
    type: 'event',
    name: 'AttemptStarted',
    inputs: [
      address('account', true),
      address('action', true),
      { name: 'attemptId', type: 'uint64', indexed: false },
      { name: 'setupNonce', type: 'uint64', indexed: false },
      { name: 'setupBody', type: 'bytes', indexed: false },
      { name: 'usedPlaces', type: 'uint256[]', indexed: false },
      { name: 'usedMethods', type: 'address[]', indexed: false },
      { name: 'payload', type: 'bytes', indexed: false },
      {
        /** The manager's `PaymentOrder` struct. */
        name: 'order',
        type: 'tuple',
        indexed: false,
        components: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'payee', type: 'address' },
        ],
      },
      { name: 'consumableAfter', type: 'uint48', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AttemptCancelled',
    inputs: [
      address('account', true),
      address('action', true),
      { name: 'attemptId', type: 'uint64', indexed: false },
      address('canceller', false),
      address('vetoingMethod', false),
      { name: 'setupNonce', type: 'uint64', indexed: false },
      { name: 'usedPlaces', type: 'uint256[]', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AttemptConsumed',
    inputs: [address('account', true), address('action', true), { name: 'attemptId', type: 'uint64', indexed: false }],
  },
] as const;

/** The recovery methods' events, including the `Ownable2Step` pair that hands over the pause holder. */
export const METHOD_EVENTS_ABI = [
  { type: 'event', name: 'Paused', inputs: [address('account', false)] },
  { type: 'event', name: 'Unpaused', inputs: [address('account', false)] },
  {
    type: 'event',
    name: 'TrustedKeysUpdated',
    inputs: [
      { name: 'previous', type: 'bytes32[]', indexed: false },
      { name: 'current', type: 'bytes32[]', indexed: false },
    ],
  },
  { type: 'event', name: 'AdminRenounced', inputs: [address('previous', false)] },
  { type: 'event', name: 'AdminTransferOffered', inputs: [address('current', true), address('pending', true)] },
  { type: 'event', name: 'AdminTransferred', inputs: [address('previous', true), address('current', true)] },
  {
    type: 'event',
    name: 'OwnershipTransferStarted',
    inputs: [address('previousOwner', true), address('newOwner', true)],
  },
  {
    type: 'event',
    name: 'OwnershipTransferred',
    inputs: [address('previousOwner', true), address('newOwner', true)],
  },
] as const;

/** The account's privilege event, as the account contract declares it. */
export const ACCOUNT_EVENTS_ABI = [
  {
    type: 'event',
    name: 'LogPrivilegeChanged',
    inputs: [address('addr', true), { name: 'priv', type: 'bytes32', indexed: false }],
  },
] as const;

const withTopics = <Event extends AbiEvent>(abi: readonly Event[]): readonly OwnedEvent<Event>[] =>
  abi.map((event) => ({ event, topic0: toEventSelector(event) }));

/** The manager's events, each with its topic0. */
export const EVENT_MANAGER_MANAGER_EVENTS = withTopics(MANAGER_EVENTS_ABI);

/** The method events, each with its topic0. */
export const EVENT_MANAGER_METHOD_EVENTS = withTopics(METHOD_EVENTS_ABI);

/** The account's event, with its topic0. */
export const EVENT_MANAGER_ACCOUNT_EVENTS = withTopics(ACCOUNT_EVENTS_ABI);

/** The width of an indexed address topic, in bytes. */
export const EVENT_MANAGER_TOPIC_SIZE = 32;
