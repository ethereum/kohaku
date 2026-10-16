import {
  BUILDER_APPROVER_INPUT_MEMBERS,
  BUILDER_CHAIN_ID_MISMATCH_MESSAGE,
  BUILDER_DEFAULT_CONFIGURATION,
  BUILDER_HOLDER_INPUT_MEMBERS,
  BUILDER_HOLDER_INPUTS_MESSAGE,
  BUILDER_NO_CHAIN_MESSAGE,
  BUILDER_NO_PUBLIC_DEPLOYMENT_MESSAGE,
  BUILDER_PROVIDER_MEMBERS,
  BUILDER_UNKNOWN_CHAIN_MESSAGE,
  FORMATS_SAFE_INTEGER_BITS,
  FORMATS_ZERO_ADDRESS,
} from '../constants';
import { KitRefusalError } from '../client-core/refusal';
import { assertDependency, assertObject, assertUintNumber, normalizeAddress } from '../formats/guards';
import { checkedConfiguration, checkedDescriptor } from '../formats/records';
import { DEVICE_BINDINGS, type ClientConfiguration, type DeploymentDescriptor, type IProvider } from '../interfaces';
import { checkedBindings } from '../methods-orchestrator/registries';
import type { BuilderHolder, BuilderInputs, SocialRecoveryInputs } from '../types/builder';
import { shippedDescriptor } from './origin';
import { assertOnly } from './shapes';

/** The partial configuration merged over the shipped default member by member, a member given as `undefined` left at the default. */
function mergedConfiguration(value: unknown): ClientConfiguration {
  if (value === undefined) return checkedConfiguration(BUILDER_DEFAULT_CONFIGURATION, 'configuration');

  assertObject(value, 'configuration');

  const given = Object.fromEntries(Object.entries(value).filter(([, member]) => member !== undefined));

  return checkedConfiguration({ ...BUILDER_DEFAULT_CONFIGURATION, ...given }, 'configuration');
}

/**
 * The provider, account and configuration of a holder's inputs, or nothing where neither a provider nor an account is given;
 * either way an own member the shape does not take is refused with a `TypeError` naming it.
 */
function checkedHolder(inputs: Readonly<Record<string, unknown>>): BuilderHolder | undefined {
  const { provider, account, configuration } = inputs;

  if (provider === undefined && account === undefined) {
    assertOnly(inputs, BUILDER_APPROVER_INPUT_MEMBERS, 'inputs', "a member of an approver's inputs");

    return undefined;
  }

  if (provider === undefined || account === undefined) throw new TypeError(BUILDER_HOLDER_INPUTS_MESSAGE);

  assertOnly(inputs, BUILDER_HOLDER_INPUT_MEMBERS, 'inputs', "a member of a holder's inputs");

  assertDependency(provider, BUILDER_PROVIDER_MEMBERS, 'provider');

  return {
    provider: provider as IProvider,
    account: normalizeAddress(account, 'account'),
    configuration: mergedConfiguration(configuration),
  };
}

/**
 * The builder's inputs checked before any provider call: a `TypeError` or `RangeError` for a malformed or unknown member, a provider
 * without an account or the reverse, inputs without a provider that name no chain, and a descriptor naming another chain id.
 */
export function checkedInputs(value: SocialRecoveryInputs): BuilderInputs {
  assertObject(value, 'inputs');

  const inputs = value as Readonly<Record<string, unknown>>;
  const holder = checkedHolder(inputs);
  const descriptor = inputs['descriptor'] === undefined ? undefined : checkedDescriptor(inputs['descriptor'], 'descriptor');
  const chainId = inputs['chainId'];

  if (chainId !== undefined) assertUintNumber(chainId, FORMATS_SAFE_INTEGER_BITS, 'chainId');

  if (descriptor !== undefined && chainId !== undefined && descriptor.chainId !== chainId) {
    throw new RangeError(BUILDER_CHAIN_ID_MISMATCH_MESSAGE);
  }

  if (holder === undefined && descriptor === undefined && chainId === undefined) throw new TypeError(BUILDER_NO_CHAIN_MESSAGE);

  const bindings = inputs['deviceBindings'] === undefined ? DEVICE_BINDINGS : inputs['deviceBindings'];

  return {
    holder,
    descriptor,
    chainId: descriptor?.chainId ?? (chainId as number | undefined),
    bindings: Object.freeze([...checkedBindings(bindings)]),
  };
}

/**
 * The descriptor a build reads: the one given, else the chain's shipped one. Refuses with a `KitRefusalError` a chain no
 * descriptor ships for and a shipped descriptor whose manager is still the zero address.
 */
export function resolvedDescriptor(given: DeploymentDescriptor | undefined, chainId: number): DeploymentDescriptor {
  if (given !== undefined) return given;

  const shipped = shippedDescriptor(chainId);

  if (shipped === undefined) throw new KitRefusalError(BUILDER_UNKNOWN_CHAIN_MESSAGE);

  if (shipped.manager === FORMATS_ZERO_ADDRESS) throw new KitRefusalError(BUILDER_NO_PUBLIC_DEPLOYMENT_MESSAGE);

  return checkedDescriptor(shipped, 'descriptor');
}
