import { describe, expect, it } from 'vitest';
import { describeRequest, describeSetup, describeStatus } from '../../src/index';
import { approvalFromVector, cancellationFromVector, codecRegistry, describingMethod, handoverRows, methodRegistry, strictCodec } from './request-fixtures';
import { ACTION_INFO, CONTEXT, DRAFT, serialize, SUPPLIED_SALT } from './setup-fixtures';
import { at, METHOD_A, paused, PAYLOAD, RECOVERY_STATE, SCOPE, SETUP_STATE, started } from './status-fixtures';

/** Keys whose string values are the holder's or a module's own words rather than codes, wherever they sit. */
const FREE_TEXT_KEYS = new Set(['label', 'methodName', 'app']);

/** Paths whose string values are the action's self-stated `actionInfo()` words; `name` and `version` are free only here. */
const FREE_TEXT_PATHS = new Set(['action.info.value.name', 'action.info.value.version']);

/** Every (key path, value) pair reachable in a value, once each; an array's items keep the array's path. */
function entries(value: unknown, path: readonly string[] = []): (readonly [readonly string[], unknown])[] {
  if (Array.isArray(value)) {
    return value.flatMap((inner) => (typeof inner === 'object' && inner !== null ? entries(inner, path) : [[path, inner] as const]));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([inner, child]) => [[[...path, inner], child] as const, ...entries(child, [...path, inner])]);
  }

  return [];
}

/** The last key of a path. */
const keyOf = (path: readonly string[]): string => path[path.length - 1] ?? '';

/** The string values holding whitespace outside the free-text keys and paths: the closed check fails where any exist. */
const sentencesIn = (description: unknown): (readonly [string, unknown])[] =>
  entries(description)
    .filter(([path, value]) => typeof value === 'string' && /\s/.test(value) && !FREE_TEXT_KEYS.has(keyOf(path)) && !FREE_TEXT_PATHS.has(path.join('.')))
    .map(([path, value]) => [path.join('.'), value] as const);

/** Recursively frozen copy, so a write to an input throws. */
function frozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !(value instanceof Map)) {
    for (const child of Object.values(value)) frozen(child);

    Object.freeze(value);
  }

  return value;
}

/** A setup description. */
type Described = ReturnType<typeof describeSetup>;

const { canonical } = handoverRows();
const approval = { ...approvalFromVector(), payload: canonical };
const cancellation = cancellationFromVector();
const codecs = codecRegistry(strictCodec([approval.action]));
const methods = methodRegistry([[approval.method, describingMethod({ kind: 'external-proving-app' }).method]]);

const descriptions = {
  setup: () => describeSetup(DRAFT, CONTEXT),
  approval: () => describeRequest(approval, codecs, methods),
  cancellation: () => describeRequest(cancellation, codecs, methods),
  status: () => describeStatus(SETUP_STATE, RECOVERY_STATE, [started(5n, [0n, 2n], PAYLOAD, at(96)), paused(METHOD_A, at(97))], SCOPE),
};

describe('every description is a closed record of values and codes', () => {
  it.each(Object.entries(descriptions))('the %s description carries no salt key', (_name, build) => {
    expect(entries(build()).filter(([path]) => keyOf(path) === 'salt')).toEqual([]);
  });

  it('the setup description never carries a supplied salt value', () => {
    expect(serialize(descriptions.setup()).toLowerCase()).not.toContain(SUPPLIED_SALT.slice(2));
  });

  it.each(['approval', 'cancellation'] as const)('the %s description never carries the request\'s salt', (name) => {
    const request = name === 'approval' ? approval : cancellation;

    expect(serialize(descriptions[name]()).toLowerCase()).not.toContain(request.salt.slice(2).toLowerCase());
  });

  it.each(Object.entries(descriptions))('the %s description holds no sentence outside labels and self-stated names', (_name, build) => {
    expect(sentencesIn(build())).toEqual([]);
  });
});

describe('the action\'s self-stated words are the only sentences it adds', () => {
  it('the setup description carries the action\'s name and version as stated, with their spaces, under action.info', () => {
    const stated = entries(descriptions.setup())
      .filter(([path, value]) => FREE_TEXT_PATHS.has(path.join('.')) && typeof value === 'string')
      .map(([path, value]) => [path.join('.'), value]);

    expect(/\s/.test(ACTION_INFO.name)).toBe(true);
    expect(stated).toEqual([['action.info.value.name', ACTION_INFO.name], ['action.info.value.version', ACTION_INFO.version]]);
  });

  it.each<[string, (d: Described) => object, string]>([
    ['a top-level name', (d) => ({ ...d, name: 'a phrase' }), 'name'],
    ['a top-level version', (d) => ({ ...d, version: '1.0 beta' }), 'version'],
    ['a name under the action but outside its info', (d) => ({ ...d, action: { ...d.action, name: 'a phrase' } }), 'action.name'],
    ['a version beside a rule credential', (d) => ({ ...d, rule: { ...d.rule, version: '2 b' } }), 'rule.version'],
  ])('fails the closed check for a whitespace string under %s', (_name, change, path) => {
    expect(sentencesIn(change(descriptions.setup())).map(([where]) => where)).toEqual([path]);
  });

  it('keeps label, methodName and app free wherever they sit', () => {
    expect(sentencesIn({ deep: { label: 'a b', methodName: 'c d', app: 'e f' } })).toEqual([]);
    expect(sentencesIn({ deep: { code: 'a b' } })).toEqual([['deep.code', 'a b']]);
  });
});

describe('every description is pure', () => {
  it('describeSetup neither writes to its inputs nor depends on anything else', () => {
    const draft = frozen(structuredClone(DRAFT));
    const context = frozen(structuredClone(CONTEXT));

    expect(describeSetup(draft, context)).toEqual(describeSetup(DRAFT, CONTEXT));
  });

  it('describeStatus neither writes to its inputs nor depends on anything else', () => {
    const latest = frozen([started(5n, [0n], PAYLOAD, at(96))]);
    const setup = frozen(structuredClone(SETUP_STATE));
    const recovery = frozen(structuredClone(RECOVERY_STATE));

    expect(describeStatus(setup, recovery, latest, SCOPE)).toEqual(describeStatus(SETUP_STATE, RECOVERY_STATE, latest, SCOPE));
  });

  it('describeRequest reads a frozen request', () => {
    expect(describeRequest(frozen(structuredClone(approval)), codecs, methods)).toEqual(descriptions.approval());
  });
});
