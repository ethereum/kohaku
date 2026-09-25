import { isAddress } from 'viem';
import type {
  AccountFilterOptions,
  Address,
  BlockRange,
  ClientConfiguration,
  DeploymentDescriptor,
  FilterSpec,
  Hex,
  IEventManager,
  IProvider,
  KitNotification,
  RawLog,
} from '../interfaces';
import type { MethodRegistry } from '../types';
import { checkChunkWidth, chunkRange } from './chunks';
import { decodeManagerLog } from './decode-manager';
import { decodeAccountLog, decodeMethodLog } from './decode-method';
import { accountFilterSpec, methodFilterSpec, privilegeFilterSpec } from './filters';
import { methodAddresses, sameAddress } from './ownership';

const checkAddress = (role: string, value: Address): Address => {
  if (!isAddress(value, { strict: false })) throw new TypeError(`The ${role} address ${value} is not an address.`);

  return value;
};

const lower = (value: Hex): Hex => value.toLowerCase() as Hex;

/** The log with every hex field but its address lower-cased, so topics match and bytes read one way. */
const withLowerHex = (log: RawLog): RawLog => ({
  ...log,
  topics: log.topics.map(lower),
  data: lower(log.data),
  blockHash: lower(log.blockHash),
  transactionHash: lower(log.transactionHash),
});

/** Orders notifications by block, then by log index; a tie keeps its arrival order. */
const byPosition = (left: KitNotification, right: KitNotification): number =>
  left.at.blockNumber - right.at.blockNumber || left.at.logIndex - right.at.logIndex;

/**
 * The `IEventManager` bound to one account and one action, reading logs through the provider.
 * It stores no logs and subscribes to nothing.
 */
export class EventManager implements IEventManager {
  private readonly provider: IProvider;
  private readonly descriptor: DeploymentDescriptor;
  private readonly account: Address;
  private readonly action: Address;
  private readonly methods: readonly Address[];
  private readonly ownedMethods: ReadonlySet<string>;
  private readonly chunkWidth: number;

  constructor(
    provider: IProvider,
    descriptor: DeploymentDescriptor,
    account: Address,
    action: Address,
    methods: MethodRegistry,
    configuration: Pick<ClientConfiguration, 'logChunkSize'>,
  ) {
    this.provider = provider;
    this.descriptor = descriptor;
    this.account = checkAddress('account', account);
    this.action = checkAddress('action', action);
    this.chunkWidth = checkChunkWidth(configuration.logChunkSize);
    checkAddress('manager', descriptor.manager);
    this.methods = methodAddresses(descriptor, methods);
    this.ownedMethods = new Set(this.methods.map((method) => method.toLowerCase()));
  }

  accountFilter(options?: AccountFilterOptions): FilterSpec {
    return accountFilterSpec(this.descriptor.manager, this.account, this.action, options);
  }

  methodFilter(): FilterSpec {
    return methodFilterSpec(this.methods);
  }

  privilegeFilter(): FilterSpec {
    return privilegeFilterSpec(this.account);
  }

  /**
   * The owned notifications in the range, read one chunk at a time and sorted by log position.
   * A chunk the provider rejects rejects the whole read.
   */
  async fetch(filter: FilterSpec, range: BlockRange): Promise<readonly KitNotification[]> {
    const notifications: KitNotification[] = [];

    for (const chunk of chunkRange(range, this.chunkWidth)) {
      const logs = await this.provider.logs(filter, chunk);

      for (const log of logs) {
        const notification = this.decodeLog(log);

        if (notification !== undefined) notifications.push(notification);
      }
    }

    return notifications.sort(byPosition);
  }

  /** The log's notification when an owned address emitted an owned event, nothing otherwise. */
  decodeLog(raw: RawLog): KitNotification | undefined {
    const log = withLowerHex(raw);
    const fromManager = sameAddress(log.address, this.descriptor.manager) ? decodeManagerLog(log) : undefined;

    if (fromManager !== undefined) return fromManager;

    const fromAccount = sameAddress(log.address, this.account) ? decodeAccountLog(log) : undefined;

    if (fromAccount !== undefined) return fromAccount;

    return this.ownedMethods.has(log.address.toLowerCase()) ? decodeMethodLog(log) : undefined;
  }
}
