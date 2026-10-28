import { BUILDER_ACTION_CLAIMED_MESSAGE, BUILDER_MODULE_CLAIMED_MESSAGE, FORMATS_ZERO_ADDRESS } from '../constants';
import { normalizeAddresses } from '../formats/guards';
import type { Address, DeploymentDescriptor, IActionCodec, IRecoveryMethod } from '../interfaces';
import { walletMethod } from '../method-ecdsa';
import { passkeyMethod } from '../method-passkey';
import { AmbireActionCodec } from '../recovery-action/codec';
import type { BuilderRegistries, BuilderSettings } from '../types/builder';
import { isActionCodec } from './shapes';

/** The modules an implementation claims under the descriptor, checksummed, the zero address left out as a module not deployed. */
const claimedModules = (method: IRecoveryMethod, descriptor: DeploymentDescriptor): Address[] =>
  normalizeAddresses(method.modules(descriptor), 'method.modules(descriptor)').filter((module) => module !== FORMATS_ZERO_ADDRESS);

/** Keys each implementation on the modules it claims outside `taken`, refusing a module another implementation already holds. */
function claimed(
  descriptor: DeploymentDescriptor,
  methods: readonly IRecoveryMethod[],
  taken: ReadonlyMap<Address, IRecoveryMethod> = new Map(),
): Map<Address, IRecoveryMethod> {
  const registry = new Map<Address, IRecoveryMethod>();

  for (const method of methods) {
    for (const module of claimedModules(method, descriptor).filter((claim) => !taken.has(claim))) {
      const holder = registry.get(module);

      if (holder !== undefined && holder !== method) throw new TypeError(`${BUILDER_MODULE_CLAIMED_MESSAGE} ${module}`);

      registry.set(module, method);
    }
  }

  return registry;
}

/**
 * The method registry keyed on each implementation's modules: an added method takes the modules it claims from the shipped
 * wallet and passkey methods, which keep only the modules no added method claims; a module two added methods claim is a
 * `TypeError`.
 */
function methodRegistry(descriptor: DeploymentDescriptor, added: readonly IRecoveryMethod[]): Map<Address, IRecoveryMethod> {
  const overrides = claimed(descriptor, added);

  return new Map([...claimed(descriptor, [walletMethod(), passkeyMethod()], overrides), ...overrides]);
}

/**
 * The codec registry keyed on every action each codec serves, the shipped codec constructed for each arguments entry and
 * for the bound action where no registered codec serves it; the same instance registered twice is keyed once, and an
 * action two different codecs serve is a `TypeError`.
 */
function codecRegistry(registered: BuilderSettings['codecs'], action: Address): Map<Address, IActionCodec> {
  const registry = new Map<Address, IActionCodec>();

  for (const entry of registered) {
    const codec = isActionCodec(entry) ? entry : new AmbireActionCodec(entry.actions);

    for (const served of normalizeAddresses(codec.actions, 'codec.actions')) {
      const holder = registry.get(served);

      if (holder !== undefined && holder !== codec) throw new TypeError(`${BUILDER_ACTION_CLAIMED_MESSAGE} ${served}`);

      registry.set(served, codec);
    }
  }

  if (!registry.has(action)) registry.set(action, new AmbireActionCodec([action]));

  return registry;
}

/** The two registries every entry shares, keyed under the descriptor, with the bound action and the codec that serves it. */
export function builtRegistries(descriptor: DeploymentDescriptor, settings: BuilderSettings): BuilderRegistries {
  const action = settings.action?.address ?? descriptor.action;
  const codecs = codecRegistry(settings.codecs, action);
  const codec = codecs.get(action) as IActionCodec;

  return { methods: methodRegistry(descriptor, settings.methods), codecs, action, codec };
}
