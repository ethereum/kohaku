import { BUILDER_EVENT_MANAGER_MEMBERS, METHODS_ORCHESTRATOR_ACTION_CODEC_MEMBERS } from '../constants';
import type { IActionCodec, IEventManager } from '../interfaces';

/** Whether the value carries any of the members as a function, which marks it as an instance rather than an arguments record. */
export const looksLikeInstance = (value: object, members: readonly string[]): boolean =>
  members.some((member) => typeof (value as Readonly<Record<string, unknown>>)[member] === 'function');

/** Whether an event manager setting is an instance rather than the shipped event manager's arguments. */
export const isEventManager = (value: object): value is IEventManager => looksLikeInstance(value, BUILDER_EVENT_MANAGER_MEMBERS);

/** Whether an action codec setting is an instance rather than the shipped codec's arguments. */
export const isActionCodec = (value: object): value is IActionCodec => looksLikeInstance(value, METHODS_ORCHESTRATOR_ACTION_CODEC_MEMBERS);

/**
 * Refuses a record carrying any own member but the listed ones, enumerable or not, a symbol-keyed member always, with a
 * `TypeError` naming the member; inherited members are not read.
 */
export function assertOnly(value: object, members: readonly string[], name: string, role = 'an argument of the shipped part'): void {
  for (const member of Reflect.ownKeys(value)) {
    if (typeof member === 'symbol' || !members.includes(member)) throw new TypeError(`${name}.${String(member)} is not ${role}`);
  }
}
