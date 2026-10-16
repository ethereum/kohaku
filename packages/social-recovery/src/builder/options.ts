import {
  BUILDER_CODEC_OPTIONS,
  BUILDER_EVENT_MANAGER_MEMBERS,
  BUILDER_EVENT_MANAGER_OPTIONS,
  BUILDER_POLICY_MANAGER_MEMBERS,
  BUILDER_RECOVERY_ACTION_MEMBERS,
  BUILDER_SIGNER_RECOVERY_MEMBERS,
  FORMATS_SAFE_INTEGER_BITS,
  METHODS_ORCHESTRATOR_ACTION_CODEC_MEMBERS,
  METHODS_ORCHESTRATOR_METHOD_MEMBERS,
  METHODS_ORCHESTRATOR_REPEAT_MESSAGE,
} from '../constants';
import { assertDependency, assertObject, assertUintNumber, normalizeAddress, normalizeAddresses } from '../formats/guards';
import type { Address, IActionCodec, IEventManager, IRecoveryMethod, ISignerRecovery } from '../interfaces';
import type {
  ActionCodecOptions,
  BuilderAction,
  BuilderPolicyManager,
  EventManagerOptions,
  RecoveryActionFactory,
  RecoveryActionPart,
} from '../types/builder';
import { assertOnly, isActionCodec, isEventManager } from './shapes';

/**
 * The actions a codec serves, checksummed: a non-list or a malformed address is a `TypeError`, an empty list or a repeated action
 * a `RangeError`.
 */
function servedActions(value: unknown): Address[] {
  const actions = normalizeAddresses(value, 'codec.actions');

  if (actions.length === 0) throw new RangeError('codec.actions must name at least one action address');

  if (new Set(actions).size !== actions.length) throw new RangeError(`codec.actions ${METHODS_ORCHESTRATOR_REPEAT_MESSAGE}`);

  return actions;
}

/** The policy manager instance, refused with a `TypeError` where a member of either interface is missing. */
export function checkedPolicyManager(value: unknown): BuilderPolicyManager {
  assertDependency(value, BUILDER_POLICY_MANAGER_MEMBERS, 'policyManager');

  return value as BuilderPolicyManager;
}

/** An event manager instance as given, or its arguments as a frozen copy, the chunk width a positive safe integer. */
export function checkedEventManager(value: unknown): IEventManager | EventManagerOptions {
  assertObject(value, 'eventManager');

  if (isEventManager(value)) {
    assertDependency(value, BUILDER_EVENT_MANAGER_MEMBERS, 'eventManager');

    return value as IEventManager;
  }

  assertOnly(value, BUILDER_EVENT_MANAGER_OPTIONS, 'eventManager');

  const { logChunkSize } = value as Partial<Record<keyof EventManagerOptions, unknown>>;

  assertUintNumber(logChunkSize, FORMATS_SAFE_INTEGER_BITS, 'eventManager.logChunkSize');

  if (logChunkSize < 1) throw new RangeError('eventManager.logChunkSize must be at least one block');

  return Object.freeze({ logChunkSize });
}

/**
 * An action codec instance as given, or its arguments as a frozen copy; either way its actions are refused at the call where
 * malformed, empty or repeated.
 */
export function checkedCodec(value: unknown): IActionCodec | ActionCodecOptions {
  assertObject(value, 'codec');

  if (isActionCodec(value)) {
    assertDependency(value, METHODS_ORCHESTRATOR_ACTION_CODEC_MEMBERS, 'codec');
    servedActions(value.actions);

    return value;
  }

  assertOnly(value, BUILDER_CODEC_OPTIONS, 'codec');

  const actions = servedActions((value as Partial<ActionCodecOptions>).actions);

  return Object.freeze({ actions: Object.freeze(actions) });
}

/** Refuses a recovery action part missing one of its reads, its disarming write or its arming write. */
export function assertActionPart(value: unknown, name: string): asserts value is RecoveryActionPart {
  assertDependency(value, BUILDER_RECOVERY_ACTION_MEMBERS, name);
}

/** The action address checksummed beside the part or factory serving it, each refused where it is malformed. */
export function checkedAction(address: unknown, implementation: unknown): BuilderAction {
  const checked: Address = normalizeAddress(address, 'action');

  if (implementation === undefined) return Object.freeze({ address: checked, implementation: undefined });

  if (typeof implementation === 'function') return Object.freeze({ address: checked, implementation: implementation as RecoveryActionFactory });

  assertActionPart(implementation, 'recoveryAction');

  return Object.freeze({ address: checked, implementation });
}

/** The method implementation, refused with a `TypeError` where one of its functions is missing. */
export function checkedMethod(value: unknown): IRecoveryMethod {
  assertDependency(value, METHODS_ORCHESTRATOR_METHOD_MEMBERS, 'method');

  return value as IRecoveryMethod;
}

/** The signer recovery, refused with a `TypeError` where it cannot recover a signer. */
export function checkedSignerRecovery(value: unknown): ISignerRecovery {
  assertDependency(value, BUILDER_SIGNER_RECOVERY_MEMBERS, 'signerRecovery');

  return value as ISignerRecovery;
}
