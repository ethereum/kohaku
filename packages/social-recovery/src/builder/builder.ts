import { BUILDER_FROZEN_MESSAGE, BUILDER_PENDING_MESSAGE } from '../constants';
import type {
  Address,
  IActionCodec,
  IEventManager,
  IMethodModuleReads,
  IMethodsOrchestrator,
  IRecoveryActionInteractor,
  IRecoveryClient,
  IRecoveryMethod,
  ISetupClient,
  ISignerRecovery,
} from '../interfaces';
import type {
  ActionCodecOptions,
  BuilderInputs,
  BuilderPolicyManager,
  BuilderSession,
  BuilderSettings,
  EventManagerOptions,
  ManagerReading,
  RecoveryActionFactory,
  RecoveryActionPart,
  SocialRecoveryHolderInputs,
  SocialRecoveryInputs,
  SocialRecoveryKit,
} from '../types/builder';
import { checkedInputs } from './inputs';
import { BuilderMemo } from './memo';
import { checkedAction, checkedCodec, checkedEventManager, checkedMethod, checkedPolicyManager, checkedSignerRecovery } from './options';
import { checkedReading } from './reading';

/**
 * The one class that constructs the kit's classes: it fills every part the integrator did not hand over with the shipped one,
 * constructs each once and hands the same instances to both clients. The first build that reaches the chain runs the
 * construction checks; every build memoizes, and once a build has succeeded or while one is still running every `with*`
 * call throws a `TypeError`; a failed build caches nothing and reopens them. A builder given no provider and no account
 * builds the methods orchestrator alone.
 */
export class SocialRecoveryBuilder<I extends SocialRecoveryInputs = SocialRecoveryHolderInputs> {
  /**
   * The inputs' shape, carried in the type alone: it keeps a builder over an approver's inputs from passing for a holder's,
   * so the client builds stay compile errors there for every consumer, the published declarations included.
   */
  declare protected readonly inputsShape?: I;

  readonly #inputs: BuilderInputs;

  #settings: BuilderSettings = {
    policyManager: undefined,
    eventManager: undefined,
    action: undefined,
    codecs: [],
    methods: [],
    signerRecovery: undefined,
    versionEscape: false,
    reading: undefined,
  };

  readonly #memo = new BuilderMemo();

  /** Throws a `TypeError` or `RangeError` on malformed inputs, before any provider call. */
  private constructor(inputs: I) {
    this.#inputs = checkedInputs(inputs);
  }

  /** A fresh builder over the inputs, checked before any provider call. */
  static from<I extends SocialRecoveryInputs>(inputs: I): SocialRecoveryBuilder<I> {
    return new SocialRecoveryBuilder(inputs);
  }

  /** The holder's kit from a fresh builder with every part the shipped one. */
  static async build(inputs: SocialRecoveryHolderInputs): Promise<SocialRecoveryKit> {
    return await SocialRecoveryBuilder.from(inputs).build();
  }

  /** Replaces the shipped policy manager with this instance. */
  withPolicyManager(manager: BuilderPolicyManager): this {
    return this.#set(() => ({ policyManager: checkedPolicyManager(manager) }));
  }

  /** Replaces the shipped event manager with this instance, or constructs the shipped one with these arguments. */
  withEventManager(manager: IEventManager | EventManagerOptions): this {
    return this.#set(() => ({ eventManager: checkedEventManager(manager) }));
  }

  /** Binds the clients to this action address, served by the part or factory given, else by the shipped Ambire part. */
  withRecoveryAction(address: Address, implementation?: RecoveryActionPart | RecoveryActionFactory): this {
    return this.#set(() => ({ action: checkedAction(address, implementation) }));
  }

  /**
   * Adds an action codec, an instance or the shipped codec's arguments, keyed on every action it serves; its actions are
   * refused at the call where empty, repeated or malformed. The same instance added again is keyed once; two different
   * codecs serving one action are a `TypeError` at the first build.
   */
  withCodec(codec: IActionCodec | ActionCodecOptions): this {
    return this.#set(() => ({ codecs: [...this.#settings.codecs, checkedCodec(codec)] }));
  }

  /**
   * Adds a method implementation, keyed on the modules it claims under the descriptor. An added method takes the modules it
   * claims from the shipped `walletMethod()` and `passkeyMethod()`, which keep only the modules no added method claims; two
   * added methods claiming one module are a `TypeError` at the first build.
   */
  withMethod(method: IRecoveryMethod): this {
    return this.#set(() => ({ methods: [...this.#settings.methods, checkedMethod(method)] }));
  }

  /** Hands both clients the signer recovery their removed-key inference reads. */
  withSignerRecovery(signerRecovery: ISignerRecovery): this {
    return this.#set(() => ({ signerRecovery: checkedSignerRecovery(signerRecovery) }));
  }

  /**
   * Downgrades the domain's `fields`, digest version and name checks and the body encoder check from refusals to a finding
   * the reading lists; where any of them failed, both clients and the handed-out action part refuse every prepare.
   */
  withVersionEscape(): this {
    return this.#set(() => ({ versionEscape: true }));
  }

  /** Takes another builder's reading of the same chain and manager in place of reading the manager again. */
  withManagerReading(reading: ManagerReading): this {
    return this.#set(() => ({ reading: checkedReading(reading) }));
  }

  /** This builder's reading of the manager, once a build has taken it. */
  managerReading(): ManagerReading | undefined {
    return this.#memo.reading;
  }

  /** The setup client, the recovery client and the methods orchestrator over one set of shared parts. */
  async build(this: SocialRecoveryBuilder<SocialRecoveryHolderInputs>): Promise<SocialRecoveryKit> {
    return await this.#memo.kit(this.#inputs, this.#settings);
  }

  async buildSetupClient(this: SocialRecoveryBuilder<SocialRecoveryHolderInputs>): Promise<ISetupClient> {
    return (await this.#built()).setupClient;
  }

  async buildRecoveryClient(this: SocialRecoveryBuilder<SocialRecoveryHolderInputs>): Promise<IRecoveryClient> {
    return (await this.#built()).recoveryClient;
  }

  /** The action part's reads and disarming write, never its arming write; under an escaped build the disarming write refuses. */
  async recoveryAction(this: SocialRecoveryBuilder<SocialRecoveryHolderInputs>): Promise<IRecoveryActionInteractor> {
    return (await this.#built()).recoveryAction;
  }

  /** The manager part's three module reads, never its prepares. */
  async methodModuleReads(this: SocialRecoveryBuilder<SocialRecoveryHolderInputs>): Promise<IMethodModuleReads> {
    return (await this.#built()).moduleReads;
  }

  /** The methods orchestrator over the two registries and the device bindings; it reads no chain and runs no check. */
  buildMethodsOrchestrator(): IMethodsOrchestrator {
    return this.#memo.orchestrator(this.#inputs, this.#settings);
  }

  /**
   * Applies one setter's change, refusing with a `TypeError` once a build has succeeded or while one is still running before
   * `change` checks the setter's argument, so the builder's state answers first.
   */
  #set(change: () => Partial<BuilderSettings>): this {
    if (this.#memo.built) throw new TypeError(BUILDER_FROZEN_MESSAGE);

    if (this.#memo.frozen) throw new TypeError(BUILDER_PENDING_MESSAGE);

    this.#settings = { ...this.#settings, ...change() };

    return this;
  }

  /** The memoized session over the settings as they stand now. */
  #built(): Promise<BuilderSession> {
    return this.#memo.session(this.#inputs, this.#settings);
  }
}
