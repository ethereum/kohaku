import type {
  Address,
  BlockTags,
  ClientConfiguration,
  DeploymentDescriptor,
  DeviceBinding,
  Domain,
  IActionCodec,
  IEventManager,
  IMethodModuleReads,
  IMethodsOrchestrator,
  IPolicyManagerInteractor,
  IProvider,
  IRecoveryActionArming,
  IRecoveryActionInteractor,
  IRecoveryClient,
  IRecoveryMethod,
  ISetupClient,
  ISignerRecovery,
  NamedBlockTag,
} from '../interfaces';
import type { ActionCodecRegistry } from './description';
import type { MethodRegistry } from './event-manager';

/** What the holder's wallet builds its two clients from; the chain id is derived from the descriptor, else from the provider. */
export type SocialRecoveryHolderInputs = {
  readonly provider: IProvider;
  readonly account: Address;
  /** Absent, the chain's shipped descriptor is read. */
  readonly descriptor?: DeploymentDescriptor;
  readonly chainId?: number;
  /** Merged over `BUILDER_DEFAULT_CONFIGURATION` member by member. */
  readonly configuration?: Partial<ClientConfiguration>;
  /** The device bindings this runtime meets; absent, all of them. Narrow it to have unmet methods answer `device-unavailable`. */
  readonly deviceBindings?: readonly DeviceBinding[];
};

/** What an approving or enrolling page builds the methods orchestrator from, with no provider and no account. */
export type SocialRecoveryApproverInputs = (
  | { readonly descriptor: DeploymentDescriptor; readonly chainId?: number }
  | { readonly descriptor?: undefined; readonly chainId: number }
) & {
  /** The device bindings this runtime meets; absent, all of them. Narrow it to have unmet methods answer `device-unavailable`. */
  readonly deviceBindings?: readonly DeviceBinding[];
  readonly provider?: never;
  readonly account?: never;
};

export type SocialRecoveryInputs = SocialRecoveryHolderInputs | SocialRecoveryApproverInputs;

/** The shipped event manager's own argument; the builder supplies the rest. */
export type EventManagerOptions = { readonly logChunkSize: number };

/** The shipped action codec's own argument: the action addresses it serves. */
export type ActionCodecOptions = { readonly actions: readonly Address[] };

/** A recovery action part: its reads and disarming write beside the arming write only the setup client receives. */
export type RecoveryActionPart = IRecoveryActionInteractor & IRecoveryActionArming;

/** The builder's own inputs a recovery action factory constructs its part over. */
export type RecoveryActionContext = {
  readonly provider: IProvider;
  readonly descriptor: DeploymentDescriptor;
  readonly account: Address;
  readonly action: Address;
  readonly codec: IActionCodec;
  readonly blockTags: BlockTags;
};

/**
 * Constructs a recovery action part over the builder's inputs; called on each construction attempt, its product kept once a
 * build succeeds and nothing kept from an attempt that fails.
 */
export type RecoveryActionFactory = (context: RecoveryActionContext) => RecoveryActionPart;

/** A construction check the version escape downgraded instead of refusing. */
export type BuilderEscapedCheck = 'fields' | 'digest-version' | 'domain-name' | 'body-encoder';

/** The builder's one reading of the manager and its judgement of it, deep-frozen and shareable with another builder. */
export type ManagerReading = Readonly<{
  chainId: number;
  manager: Address;
  domain: Domain;
  version: string;
  /** The checks that failed and were downgraded by the version escape; empty where none failed. */
  escaped: readonly BuilderEscapedCheck[];
  /** Whether `version()` disagreed with the descriptor's `managerVersion`, which never refuses. */
  versionMismatch: boolean;
}>;

/** The holder's three entries, built over one set of shared parts. */
export type SocialRecoveryKit = Readonly<{
  setupClient: ISetupClient;
  recoveryClient: IRecoveryClient;
  methodsOrchestrator: IMethodsOrchestrator;
}>;

/** The policy manager part an integrator hands the builder in place of the shipped one. */
export type BuilderPolicyManager = IPolicyManagerInteractor & IMethodModuleReads;

/** The holder's inputs as checked at `from`, the configuration merged and checked whole. */
export type BuilderHolder = {
  readonly provider: IProvider;
  readonly account: Address;
  readonly configuration: ClientConfiguration;
};

/** A builder's inputs as checked at `from`. */
export type BuilderInputs = {
  readonly holder: BuilderHolder | undefined;
  readonly descriptor: DeploymentDescriptor | undefined;
  readonly chainId: number | undefined;
  readonly bindings: readonly DeviceBinding[];
};

/** The recovery action the integrator named: its address, and the part or factory serving it where one was given. */
export type BuilderAction = {
  readonly address: Address;
  readonly implementation: RecoveryActionPart | RecoveryActionFactory | undefined;
};

/** Everything the `with*` calls collected, each checked at its call. */
export type BuilderSettings = {
  readonly policyManager: BuilderPolicyManager | undefined;
  readonly eventManager: IEventManager | EventManagerOptions | undefined;
  readonly action: BuilderAction | undefined;
  readonly codecs: readonly (IActionCodec | ActionCodecOptions)[];
  readonly methods: readonly IRecoveryMethod[];
  readonly signerRecovery: ISignerRecovery | undefined;
  readonly versionEscape: boolean;
  readonly reading: ManagerReading | undefined;
};

/** The two registries every entry shares, with the action they are bound to and the codec serving it. */
export type BuilderRegistries = {
  readonly methods: MethodRegistry;
  readonly codecs: ActionCodecRegistry;
  readonly action: Address;
  readonly codec: IActionCodec;
};

/** What a successful construction sequence leaves behind for every later build. */
export type BuilderSession = {
  readonly reading: ManagerReading;
  readonly registries: BuilderRegistries;
  readonly setupClient: ISetupClient;
  readonly recoveryClient: IRecoveryClient;
  readonly recoveryAction: IRecoveryActionInteractor;
  readonly moduleReads: IMethodModuleReads;
};

/** What a build reads the chain under: the inputs as checked, the read tag, the escape option and any reading handed over. */
export type SequenceInputs = {
  readonly provider: IProvider;
  readonly descriptor: DeploymentDescriptor | undefined;
  readonly chainId: number | undefined;
  readonly readTag: NamedBlockTag;
  readonly versionEscape: boolean;
  readonly reading: ManagerReading | undefined;
};
