import {
  FORMATS_ZERO_ADDRESS,
  METHODS_ORCHESTRATOR_ACTION_CODEC_MEMBERS,
  METHODS_ORCHESTRATOR_ENTRY_LENGTH,
  METHODS_ORCHESTRATOR_ENTRY_PAIR_MESSAGE,
  METHODS_ORCHESTRATOR_FOREIGN_ACTION_MESSAGE,
  METHODS_ORCHESTRATOR_METHOD_CODEC_MEMBERS,
  METHODS_ORCHESTRATOR_METHOD_MEMBERS,
  METHODS_ORCHESTRATOR_NOT_ITERABLE_MESSAGE,
  METHODS_ORCHESTRATOR_NOT_STRING_MESSAGE,
  METHODS_ORCHESTRATOR_REGISTRY_MEMBERS,
  METHODS_ORCHESTRATOR_REPEAT_MESSAGE,
  METHODS_ORCHESTRATOR_UNKNOWN_VALUE_MESSAGE,
  METHODS_ORCHESTRATOR_ZERO_KEY_MESSAGE,
} from '../constants';
import { assertDense, assertDependency, normalizeAddress, normalizeAddresses } from '../formats/guards';
import {
  DEVICE_BINDINGS,
  METHOD_TIERS,
  type Address,
  type DeviceBinding,
  type IActionCodec,
  type IRecoveryMethod,
} from '../interfaces';

/** Refuses a value outside a closed list: a `TypeError` for a non-string, a `RangeError` for an unknown string. */
function assertOneOf<Value extends string>(value: unknown, allowed: readonly Value[], name: string): asserts value is Value {
  if (typeof value !== 'string') throw new TypeError(`${name} ${METHODS_ORCHESTRATOR_NOT_STRING_MESSAGE}`);

  if (!(allowed as readonly string[]).includes(value)) {
    throw new RangeError(`${name} ${METHODS_ORCHESTRATOR_UNKNOWN_VALUE_MESSAGE} ${allowed.join(', ')}`);
  }
}

/** Refuses anything but an array of strings with no hole. */
function assertStrings(value: unknown, name: string): void {
  assertDense(value, name);

  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== 'string') throw new TypeError(`${name}[${index}] ${METHODS_ORCHESTRATOR_NOT_STRING_MESSAGE}`);
  }
}

/** The key and value of one registry entry, refusing an entry that is not exactly two own slots. */
function pairOf(entry: unknown, name: string): readonly [unknown, unknown] {
  assertDense(entry, name, METHODS_ORCHESTRATOR_ENTRY_LENGTH);

  if (entry.length !== METHODS_ORCHESTRATOR_ENTRY_LENGTH) throw new TypeError(`${name} ${METHODS_ORCHESTRATOR_ENTRY_PAIR_MESSAGE}`);

  return [entry[0], entry[1]];
}

/** Every entry of a map-like registry, keys checksummed, refusing a malformed, zero or repeated key. */
function checkedEntries(registry: unknown, name: string): [Address, unknown][] {
  assertDependency(registry, METHODS_ORCHESTRATOR_REGISTRY_MEMBERS, name);

  if (typeof (registry as Partial<Iterable<unknown>>)[Symbol.iterator] !== 'function') {
    throw new TypeError(`${name} ${METHODS_ORCHESTRATOR_NOT_ITERABLE_MESSAGE}`);
  }

  const entries: [Address, unknown][] = [];
  const seen = new Set<Address>();

  let position = 0;

  for (const entry of registry as Iterable<unknown>) {
    const [rawKey, value] = pairOf(entry, `${name} entry ${position}`);
    const key = normalizeAddress(rawKey, `${name} key`);

    if (key === FORMATS_ZERO_ADDRESS) throw new RangeError(`${name} key ${METHODS_ORCHESTRATOR_ZERO_KEY_MESSAGE}`);

    if (seen.has(key)) throw new TypeError(`${name} ${METHODS_ORCHESTRATOR_REPEAT_MESSAGE}: ${key}`);

    seen.add(key);
    entries.push([key, value]);
    position += 1;
  }

  return entries;
}

/** Refuses a method implementation missing a member of the interface or carrying an unknown binding or tier. */
function assertMethod(value: unknown, name: string): asserts value is IRecoveryMethod {
  assertDependency(value, METHODS_ORCHESTRATOR_METHOD_MEMBERS, name);

  const method = value as Partial<Record<keyof IRecoveryMethod, unknown>>;

  assertDependency(method.codec, METHODS_ORCHESTRATOR_METHOD_CODEC_MEMBERS, `${name}.codec`);
  assertOneOf(method.deviceBinding, DEVICE_BINDINGS, `${name}.deviceBinding`);
  assertStrings(method.vector, `${name}.vector`);

  if (method.tier !== undefined) assertOneOf(method.tier, METHOD_TIERS, `${name}.tier`);
}

/** A private copy of the method registry keyed by checksummed address, every implementation checked whole. */
export function checkedMethods(registry: unknown): ReadonlyMap<Address, IRecoveryMethod> {
  const methods = new Map<Address, IRecoveryMethod>();

  for (const [key, value] of checkedEntries(registry, 'methods')) {
    assertMethod(value, `methods[${key}]`);
    methods.set(key, value);
  }

  return methods;
}

/** A private copy of the codec registry keyed by checksummed address, each codec keyed on one of its own actions. */
export function checkedCodecs(registry: unknown): ReadonlyMap<Address, IActionCodec> {
  const codecs = new Map<Address, IActionCodec>();

  for (const [key, value] of checkedEntries(registry, 'codecs')) {
    const name = `codecs[${key}]`;

    assertDependency(value, METHODS_ORCHESTRATOR_ACTION_CODEC_MEMBERS, name);

    const actions = normalizeAddresses((value as Partial<IActionCodec>).actions, `${name}.actions`);

    if (!actions.includes(key)) throw new RangeError(`${name} key ${METHODS_ORCHESTRATOR_FOREIGN_ACTION_MESSAGE}`);

    codecs.set(key, value as IActionCodec);
  }

  return codecs;
}

/** The device bindings this runtime meets, refusing a hole, an unknown binding and a repeat. */
export function checkedBindings(value: unknown): ReadonlySet<DeviceBinding> {
  assertDense(value, 'bindings');

  const bindings = new Set<DeviceBinding>();

  for (let index = 0; index < value.length; index += 1) {
    const binding: unknown = value[index];

    assertOneOf(binding, DEVICE_BINDINGS, `bindings[${index}]`);

    if (bindings.has(binding)) throw new TypeError(`bindings ${METHODS_ORCHESTRATOR_REPEAT_MESSAGE}: ${binding}`);

    bindings.add(binding);
  }

  return bindings;
}
