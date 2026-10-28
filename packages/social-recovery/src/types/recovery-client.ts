import type {
  ActionState,
  Address,
  ClientConfiguration,
  DeploymentDescriptor,
  GatheringPlace,
  Hex,
  IActionCodec,
  IEventManager,
  IPolicyManagerInteractor,
  IProvider,
  IRecoveryActionInteractor,
  ISignerRecovery,
  RemovedKeyUnnamed,
  Standing,
} from '../interfaces';
import type { PinnedHeader } from './client-core';
import type { MethodRegistry } from './event-manager';
import type { GatheringMembers } from './gathering';

/** The parts and bindings a recovery client holds once checked, every address in its checksummed spelling. */
export type RecoveryClientParts = {
  readonly provider: IProvider;
  readonly descriptor: DeploymentDescriptor;
  readonly account: Address;
  readonly action: Address;
  readonly configuration: ClientConfiguration;
  readonly policyManager: IPolicyManagerInteractor;
  readonly recoveryAction: IRecoveryActionInteractor;
  readonly events: IEventManager;
  readonly methods: MethodRegistry;
  readonly codec: IActionCodec;
  readonly signerRecovery: ISignerRecovery | undefined;
  /** The wallet method, whose configs each hold one guardian address. */
  readonly walletMethod: Address;
};

/** The block an init pinned and the manager's state read at it. */
export type InitReading = {
  readonly pinned: PinnedHeader;
  readonly state: ActionState;
};

/** The restored setup as a gathering carries it: the encoded body and the whole place map. */
export type GatheredSetup = {
  readonly setupBody: Hex;
  readonly places: GatheringPlace[];
};

/** A rule method's stop as read once at the pinned block. */
export type MethodStop = {
  readonly standing: Standing;
  readonly stoppable: boolean;
};

/** The request members both gatherings share. */
export type SharedRequest = Omit<Extract<GatheringMembers, { readonly purpose: 'cancellation' }>['request'], 'consumableAfter'>;

/** The removed key a handover names, the action's answer for it where one was read, and why none was named. */
export type ResolvedRemovedKey = {
  readonly named: Address | undefined;
  readonly removedIsAuthority: boolean | undefined;
  readonly unknown: RemovedKeyUnnamed | undefined;
};
