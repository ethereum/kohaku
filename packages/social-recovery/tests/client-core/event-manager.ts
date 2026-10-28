import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbi } from 'viem';
import {
  EventManager,
  type BlockRange,
  type DeploymentDescriptor,
  type FilterSpec,
  type Hex,
  type IProvider,
  type RawLog,
} from '../../src/index';
import { ACCOUNT, ACTION, MANAGER } from './support';

const SETUP_COMMITTED = parseAbi([
  'event SetupCommitted(address indexed account, address indexed action, uint64 nonce, bytes32 setupCommitment, bytes publicMetadata, bytes privateMetadata)',
]);

const DESCRIPTOR: DeploymentDescriptor = {
  chainId: 11_155_111,
  manager: MANAGER,
  methodEcdsa: getAddress(`0x${'e1'.repeat(20)}`),
  methodPasskey: getAddress(`0x${'e2'.repeat(20)}`),
  methodAadhaar: getAddress(`0x${'e3'.repeat(20)}`),
  methodZkpassport: getAddress(`0x${'e4'.repeat(20)}`),
  action: ACTION,
  servedImplementation: getAddress(`0x${'e5'.repeat(20)}`),
  deployedAt: 1,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [],
  auditedActions: [ACTION],
};

/** Where a raw log sits; `removed` marks a log the client library reported as reorganized out. */
export type Place = { readonly blockNumber: number; readonly logIndex?: number; readonly removed?: boolean };

/** A raw manager log with the given topics and data at the given place. */
export const managerLog = (topics: readonly Hex[], data: Hex, place: Place): RawLog => ({
  address: MANAGER,
  topics,
  data,
  blockNumber: place.blockNumber,
  blockHash: `0x${place.blockNumber.toString(16).padStart(64, '0')}`,
  logIndex: place.logIndex ?? 0,
  transactionHash: `0x${(place.blockNumber * 100 + (place.logIndex ?? 0)).toString(16).padStart(64, '0')}`,
  ...(place.removed === undefined ? {} : { removed: place.removed }),
});

/** A raw `SetupCommitted` log of the bound account and action, encoded independently with viem. */
export function setupCommittedLog(nonce: bigint, setupCommitment: Hex, privateMetadata: Hex, place: Place): RawLog {
  const topics = encodeEventTopics({ abi: SETUP_COMMITTED, eventName: 'SetupCommitted', args: { account: ACCOUNT, action: ACTION } });
  const data = encodeAbiParameters(
    [{ type: 'uint64' }, { type: 'bytes32' }, { type: 'bytes' }, { type: 'bytes' }],
    [nonce, setupCommitment, '0x', privateMetadata],
  );

  return managerLog(topics as Hex[], data, place);
}

/** A real `EventManager` over a provider that answers every `logs` read with the logs inside the range. */
export function realEvents(logs: readonly RawLog[]): { readonly manager: EventManager; readonly ranges: BlockRange[]; readonly filters: FilterSpec[] } {
  const ranges: BlockRange[] = [];
  const filters: FilterSpec[] = [];
  const unused = async (): Promise<never> => {
    throw new Error('the restore reads nothing but logs');
  };

  const provider: IProvider = {
    chainId: unused,
    call: unused,
    block: unused,
    code: unused,
    transaction: unused,
    async logs(filter, range) {
      filters.push(filter);
      ranges.push(range);

      return logs.filter((log) => log.blockNumber >= range.from && log.blockNumber <= range.to);
    },
  };

  const manager = new EventManager(provider, DESCRIPTOR, ACCOUNT, ACTION, new Map(), { logChunkSize: 1_000 });

  return { manager, ranges, filters };
}
