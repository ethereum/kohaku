import { BUILDER_APPROVER_MESSAGE, BUILDER_UNRESOLVED_CHAIN_MESSAGE } from '../constants';
import type { IMethodsOrchestrator } from '../interfaces';
import { MethodsOrchestrator } from '../methods-orchestrator';
import type { BuilderInputs, BuilderRegistries, BuilderSession, BuilderSettings, ManagerReading, SocialRecoveryKit } from '../types/builder';
import { resolvedDescriptor } from './inputs';
import { assembledSession } from './parts';
import { builtRegistries } from './registries';
import { constructionChecks } from './sequence';

/** The construction checks, then every shared part and both clients over the settings as they stood when it started. */
async function constructedSession(
  inputs: BuilderInputs,
  settings: BuilderSettings,
  registries: () => BuilderRegistries | undefined,
): Promise<BuilderSession> {
  const { holder } = inputs;

  if (holder === undefined) throw new TypeError(BUILDER_APPROVER_MESSAGE);

  const { descriptor, reading } = await constructionChecks({
    provider: holder.provider,
    descriptor: inputs.descriptor,
    chainId: inputs.chainId,
    readTag: holder.configuration.blockTags.read,
    versionEscape: settings.versionEscape,
    reading: settings.reading,
  });

  return assembledSession(holder, descriptor, reading, registries() ?? builtRegistries(descriptor, settings), settings);
}

/**
 * What one builder has constructed: each entry once, committed only when the build asking for it succeeds, and frozen
 * against further settings after the first success.
 */
export class BuilderMemo {
  #built = false;
  #pending: Promise<BuilderSession> | undefined;
  #session: BuilderSession | undefined;
  #registries: BuilderRegistries | undefined;
  #orchestrator: IMethodsOrchestrator | undefined;
  #kit: SocialRecoveryKit | undefined;

  /** Whether a build has succeeded or is still running, either of which bars a setting from changing. */
  get frozen(): boolean {
    return this.#built || this.#pending !== undefined;
  }

  /** Whether a build has succeeded. */
  get built(): boolean {
    return this.#built;
  }

  /** The reading the session took, once one has. */
  get reading(): ManagerReading | undefined {
    return this.#session?.reading;
  }

  /** The session, constructed once; a failed construction caches nothing, so a later build runs the checks again. */
  async session(inputs: BuilderInputs, settings: BuilderSettings): Promise<BuilderSession> {
    return await this.#construction(inputs, settings).then(
      (session) => this.#committed(session),
      (thrown: unknown) => this.#abandoned(thrown),
    );
  }

  /**
   * The bundle over the session and the orchestrator, committed only once both are constructed: a failure anywhere leaves
   * the builder as it stood before, every product an earlier build committed still cached.
   */
  async kit(inputs: BuilderInputs, settings: BuilderSettings): Promise<SocialRecoveryKit> {
    if (this.#kit !== undefined) return this.#kit;

    return await this.#construction(inputs, settings).then(
      (session) => {
        let orchestrator: IMethodsOrchestrator;

        try {
          const { methods, codecs } = session.registries;

          orchestrator = this.#orchestrator ?? new MethodsOrchestrator(methods, codecs, inputs.bindings);
        } catch (thrown) {
          return this.#abandoned(thrown);
        }

        const { setupClient, recoveryClient } = this.#committed(session);

        this.#orchestrator ??= orchestrator;
        this.#kit ??= Object.freeze({ setupClient, recoveryClient, methodsOrchestrator: this.#orchestrator });

        return this.#kit;
      },
      (thrown: unknown) => this.#abandoned(thrown),
    );
  }

  /**
   * The orchestrator over the registries the session keyed, else over registries keyed under the descriptor the inputs
   * name; a holder that names no chain gets a `TypeError` until a client build has resolved one.
   */
  orchestrator(inputs: BuilderInputs, settings: BuilderSettings): IMethodsOrchestrator {
    if (this.#orchestrator !== undefined) return this.#orchestrator;

    if (this.#registries === undefined && inputs.chainId === undefined) throw new TypeError(BUILDER_UNRESOLVED_CHAIN_MESSAGE);

    const registries = this.#registries ?? builtRegistries(resolvedDescriptor(inputs.descriptor, inputs.chainId as number), settings);
    const orchestrator = new MethodsOrchestrator(registries.methods, registries.codecs, inputs.bindings);

    this.#registries = registries;
    this.#orchestrator = orchestrator;
    this.#built = true;

    return orchestrator;
  }

  /** The committed session, else the construction already running, else a new one; nothing is cached until a build commits it. */
  #construction(inputs: BuilderInputs, settings: BuilderSettings): Promise<BuilderSession> {
    if (this.#session !== undefined) return Promise.resolve(this.#session);

    this.#pending ??= constructedSession(inputs, settings, () => this.#registries);

    return this.#pending;
  }

  /** Caches the session a build succeeded with and freezes the settings. */
  #committed(session: BuilderSession): BuilderSession {
    this.#session ??= session;
    this.#registries ??= session.registries;
    this.#pending = undefined;
    this.#built = true;

    return this.#session;
  }

  /** Drops the construction a build failed with, so the settings reopen and a later build reads again. */
  #abandoned(thrown: unknown): never {
    if (this.#session === undefined) this.#pending = undefined;

    throw thrown;
  }
}
