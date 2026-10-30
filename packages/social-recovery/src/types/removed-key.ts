import type {
  Address,
  DeploymentDescriptor,
  IActionCodec,
  IEventManager,
  IProvider,
  IRecoveryActionInteractor,
  ISignerRecovery,
  KitNotification,
} from '../interfaces';

/** What `inferRemovedKey` reads to name the key a handover removes for one account and one action. */
export type RemovedKeyInputs = {
  /** Bound to the same account and action. */
  readonly events: Pick<IEventManager, 'accountFilter' | 'fetch'>;
  readonly action: Pick<IRecoveryActionInteractor, 'isAuthority'>;
  /** Must serve `actionAddress`. */
  readonly codec: IActionCodec;
  readonly provider: Pick<IProvider, 'transaction'>;
  /** Without it no transaction is read and no signer recovered. */
  readonly signerRecovery?: ISignerRecovery;
  /** When given, the only candidate: no event or transaction is read, a denial answers `not-a-key`, and a rejected `isAuthority` rejects as itself. */
  readonly supplied?: Address;
  readonly descriptor: DeploymentDescriptor;
  readonly account: Address;
  readonly actionAddress: Address;
};

/** The inputs once checked, every address in its checksummed spelling. */
export type CheckedRemovedKeyInputs = Omit<RemovedKeyInputs, 'supplied' | 'account' | 'actionAddress'> & {
  readonly supplied: Address | undefined;
  readonly account: Address;
  readonly actionAddress: Address;
};

/** One step's answer: a confirmed key, a named key `isAuthority` denied, a failed read, or nothing named. */
export type RemovedKeyStepAnswer = Address | 'denied' | 'unread' | undefined;

/** The handover notification kinds the inference selects among. */
export type RemovedKeyNotification = Extract<
  KitNotification,
  { readonly kind: 'setup-committed' | 'attempt-started' | 'attempt-consumed' }
>;
