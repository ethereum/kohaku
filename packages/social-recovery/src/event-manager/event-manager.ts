import { isAddress } from 'viem';
import type {
  AccountFilterOptions,
  Address,
  BlockRange,
  ClientConfiguration,
  DeploymentDescriptor,
  FetchedNotifications,
  FilterSpec,
  Hex,
  IEventManager,
  IProvider,
  KitNotification,
  RawLog,
  SkippedLog,
} from '../interfaces';
import { byPosition } from '../formats/notifications';
import type { MethodRegistry } from '../types';
import { checkChunkWidth, chunkRange } from './chunks';
import { decodeManagerLog } from './decode-manager';
import { decodeAccountLog, decodeMethodLog } from './decode-method';
import { accountFilterSpec, methodFilterSpec, privilegeFilterSpec } from './filters';
import { methodAddresses, sameAddress } from './ownership';
import { positionOf } from './position';

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

/** The first notification one of the decoders, tried in order, reads from the log; nothing when none does. */
const firstDecoded = (decoders: readonly (typeof decodeManagerLog)[], log: RawLog): KitNotification | undefined => {
  for (const decode of decoders) {
    const notification = decode(log);

    if (notification !== undefined) return notification;
  }

  return undefined;
};

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
   * The owned notifications in the range, read one chunk at a time, and every owned log whose decoder threw, with its position;
   * both lists sorted by log position. A chunk the provider rejects, or answers with anything but logs, rejects the whole read.
   */
  async fetch(filter: FilterSpec, range: BlockRange): Promise<FetchedNotifications> {
    const notifications: KitNotification[] = [];
    const skipped: SkippedLog[] = [];

    for (const chunk of chunkRange(range, this.chunkWidth)) {
      const logs = await this.provider.logs(filter, chunk);

      for (const raw of logs) {
        const log = withLowerHex(raw);
        const decoders = this.decodersOf(log);

        try {
          const notification = firstDecoded(decoders, log);

          if (notification !== undefined) notifications.push(notification);
        } catch (error) {
          skipped.push({ at: positionOf(log), log: raw, error });
        }
      }
    }

    return { notifications: notifications.sort(byPosition), skipped: skipped.sort(byPosition) };
  }

  /** The log's notification when an owned address emitted an owned event, nothing otherwise. */
  decodeLog(raw: RawLog): KitNotification | undefined {
    const log = withLowerHex(raw);

    return firstDecoded(this.decodersOf(log), log);
  }

  /** The decoders of every owner of the lower-cased log's emitter: the manager's, then the account's, then the methods'. */
  private decodersOf(log: RawLog): readonly (typeof decodeManagerLog)[] {
    return [
      ...(sameAddress(log.address, this.descriptor.manager) ? [decodeManagerLog] : []),
      ...(sameAddress(log.address, this.account) ? [decodeAccountLog] : []),
      ...(this.ownedMethods.has(log.address.toLowerCase()) ? [decodeMethodLog] : []),
    ];
  }
}
