import type {
  ActionInfo,
  ActionState,
  Address,
  BlockHeader,
  ClientConfiguration,
  DeploymentDescriptor,
  Hex,
  Handover,
  KitNotification,
  MethodTier,
  ModuleInfo,
  Moment,
  Parties,
  PaymentOrder,
  ProofPlace,
  ReadResult,
  ValidationError,
  ValidationWarning,
} from '../interfaces';
import type { SetupBody } from './formats';

/** A request window as the record carrying it states it, every value in seconds. */
export type WindowFacts = {
  readonly validUntil: number;
  /** The pinned block's timestamp, where the window is measured from. */
  readonly blockTimestamp: number;
  /** Present on a cancellation alone: when the attempt it cancels becomes spendable. */
  readonly consumableAfter?: number;
};

/** Who supplied the descriptor a judgment read its shipped and audited sets from. */
export type DescriptorOrigin = 'kit' | 'integrator';

/** One named method module's reads at the pinned block, each beside whether it was answered at all. */
export type MethodReads = {
  readonly module: Address;
  readonly moduleInfo: ReadResult<ModuleInfo>;
  readonly trustedParties: ReadResult<Parties>;
  readonly paused: ReadResult<boolean>;
  /** Whether an implementation registered in this build serves the module. */
  readonly implemented: boolean;
  /** The tier the serving implementation states, absent where no implementation places it. */
  readonly tier?: MethodTier;
};

/** One method's verification cost in gas, per place it fills. */
export type MethodCost = {
  readonly method: Address;
  readonly gas: number;
};

/** The action contract's reads at the pinned block. */
export type ActionReads = {
  readonly address: Address;
  readonly actionInfo: ReadResult<ActionInfo>;
  readonly supportsAccount: boolean;
};

/** The reads a setup client hands `validateSetup`, all pinned to one block. */
export type SetupValidationContext = {
  readonly account: Address;
  readonly descriptor: DeploymentDescriptor;
  readonly descriptorOrigin: DescriptorOrigin;
  readonly configuration: ClientConfiguration;
  readonly block: BlockHeader;
  /** One entry per distinct method the draft names. */
  readonly methods: readonly MethodReads[];
  readonly action: ActionReads;
  /** The manager's setup notifications over the account with the action topic left open. */
  readonly managerEvents: readonly KitNotification[];
  /** A method without an entry leaves the rule's cost unjudged. */
  readonly costs: readonly MethodCost[];
};

/** The handover an opening request's payload carries, and whether the payload decodes in the action's layout. */
export type HandoverReads = {
  readonly handover: Handover;
  readonly layoutDecodes: boolean;
  /** The action's `isAuthority` answer for the removed key, absent where the handover names none. */
  readonly removedIsAuthority?: boolean;
  /** The action's `holdsAnyPrivilege` answer for the new key. */
  readonly newHoldsAnyPrivilege: boolean;
};

/** The reads a recovery client hands `validateRequest`, all pinned to one block. */
export type RequestValidationContext = {
  readonly state: ActionState;
  readonly block: BlockHeader;
  readonly moment: Moment;
  readonly configuration: ClientConfiguration;
  /** One entry per distinct method the request's places name. */
  readonly paused: readonly { readonly method: Address; readonly paused: ReadResult<boolean> }[];
  /** The method modules a registered implementation in this build serves. */
  readonly implementedMethods: readonly Address[];
  /** Required on an opening request, ignored on a cancellation. */
  readonly handover?: HandoverReads;
  /** The account's balance in the order's token, required on an opening request. */
  readonly balance?: bigint;
};

/** One draft credential with the flat place it fills across all clauses in body order, its config in lower case. */
export type PlacedCredential = {
  readonly place: number;
  readonly clause: number;
  readonly method: Address;
  readonly config: Hex;
  readonly salt?: Hex;
  readonly label?: string;
};

/** A request checked for shape, its addresses checksummed, its proofs in array order and its body decoded where it decodes. */
export type CheckedRequest = {
  readonly account: Address;
  readonly action: Address;
  readonly attemptId: bigint;
  readonly setupNonce: bigint;
  readonly setupBody: Hex;
  readonly validUntil: number;
  readonly proofs: readonly ProofPlace[];
  readonly body?: SetupBody;
} & (
  | { readonly opening: true; readonly payload: Hex; readonly order: PaymentOrder }
  | { readonly opening: false }
);

/** The findings one judgment collects, appended to as each check runs. */
export type Findings = {
  readonly errors: ValidationError[];
  readonly warnings: ValidationWarning[];
};

/** A manager notification that commits or clears a setup. */
export type SetupEvent = Extract<KitNotification, { readonly kind: 'setup-committed' | 'setup-cleared' }>;
