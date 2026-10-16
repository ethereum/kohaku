import { EventManager } from '../event-manager';
import type { DeploymentDescriptor, IEventManager } from '../interfaces';
import { PolicyManager } from '../policy-manager';
import { AmbireRecoveryAction } from '../recovery-action/action';
import { RecoveryClient } from '../recovery-client';
import { SetupClient } from '../setup-client';
import type {
  BuilderHolder,
  BuilderRegistries,
  BuilderSession,
  BuilderSettings,
  ManagerReading,
  RecoveryActionContext,
  RecoveryActionPart,
} from '../types/builder';
import { assertActionPart } from './options';
import { isEventManager } from './shapes';
import { actionView, moduleReadsView } from './views';

/** The action part the integrator handed over, else the one its factory constructs, else the shipped Ambire part. */
function actionPart(implementation: BuilderSettings['action'], context: RecoveryActionContext): RecoveryActionPart {
  const given = implementation?.implementation;

  if (given === undefined) {
    const { provider, descriptor, account, action, codec, blockTags } = context;

    return new AmbireRecoveryAction(provider, descriptor, account, action, codec, blockTags);
  }

  if (typeof given !== 'function') return given;

  const constructed = given(context);

  assertActionPart(constructed, 'recoveryAction factory result');

  return constructed;
}

/** The event manager handed over, else the shipped one over the method registry, its chunk width from its own arguments or the configuration. */
function eventManager(holder: BuilderHolder, descriptor: DeploymentDescriptor, registries: BuilderRegistries, given: BuilderSettings['eventManager']): IEventManager {
  if (given !== undefined && isEventManager(given)) return given;

  const logChunkSize = given?.logChunkSize ?? holder.configuration.logChunkSize;

  return new EventManager(holder.provider, descriptor, holder.account, registries.action, registries.methods, { logChunkSize });
}

/**
 * Every shared part constructed once and both clients over the same instances; the recovery client takes the action part
 * typed without its arming write, and the part handed out never carries it. The clients refuse every prepare where the
 * reading lists a check the version escape downgraded.
 */
export function assembledSession(
  holder: BuilderHolder,
  descriptor: DeploymentDescriptor,
  reading: ManagerReading,
  registries: BuilderRegistries,
  settings: BuilderSettings,
): BuilderSession {
  const { provider, account, configuration } = holder;
  const { blockTags } = configuration;
  const { action, codec, methods } = registries;
  const versionEscaped = reading.escaped.length > 0;
  const policyManager = settings.policyManager ?? new PolicyManager(provider, descriptor, account, action, blockTags);
  const context: RecoveryActionContext = Object.freeze({ provider, descriptor, account, action, codec, blockTags });
  const recoveryAction = actionPart(settings.action, context);
  const events = eventManager(holder, descriptor, registries, settings.eventManager);
  const { signerRecovery } = settings;

  return {
    reading,
    registries,
    setupClient: new SetupClient(
      provider,
      descriptor,
      account,
      action,
      configuration,
      policyManager,
      recoveryAction,
      events,
      methods,
      codec,
      signerRecovery,
      versionEscaped,
    ),
    recoveryClient: new RecoveryClient(
      provider,
      descriptor,
      account,
      action,
      configuration,
      policyManager,
      recoveryAction,
      events,
      methods,
      codec,
      signerRecovery,
      versionEscaped,
    ),
    recoveryAction: actionView(recoveryAction, versionEscaped),
    moduleReads: moduleReadsView(policyManager),
  };
}
