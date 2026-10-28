import type {
  Address,
  ClientConfiguration,
  DeploymentDescriptor,
  IActionCodec,
  IEventManager,
  IPolicyManagerInteractor,
  IProvider,
  IRecoveryActionArming,
  IRecoveryActionInteractor,
  ISignerRecovery,
} from '../interfaces';
import type { MethodRegistry } from './event-manager';
import type { ActionReads, DescriptorOrigin, MethodReads } from './validation';

/** The recovery action part a setup client takes: its reads and disarming write beside its arming write. */
export type SetupClientRecoveryAction = IRecoveryActionInteractor & IRecoveryActionArming;

/** Everything a setup client was built with, checked, its addresses checksummed. */
export type SetupClientParts = {
  readonly provider: IProvider;
  readonly descriptor: DeploymentDescriptor;
  readonly account: Address;
  readonly action: Address;
  readonly configuration: ClientConfiguration;
  readonly descriptorOrigin: DescriptorOrigin;
  readonly policyManager: IPolicyManagerInteractor;
  readonly recoveryAction: SetupClientRecoveryAction;
  readonly events: IEventManager;
  readonly methods: MethodRegistry;
  readonly codec: IActionCodec;
  readonly signerRecovery: ISignerRecovery | undefined;
};

/** The method and action reads both setup judgments take, at one pinned block. */
export type JudgmentReads = {
  readonly methods: readonly MethodReads[];
  readonly action: ActionReads;
};
