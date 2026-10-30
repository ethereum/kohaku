import { describe, expect, it } from 'vitest';
import { describeRequest, describeSetup, describeStatus } from '../../src/index';
import { approvalFromVector, cancellationFromVector, codecRegistry, describingMethod, handoverRows, methodRegistry, strictCodec } from './request-fixtures';
import { CONTEXT, DRAFT, serialize, SUPPLIED_SALT } from './setup-fixtures';
import { at, METHOD_A, paused, PAYLOAD, RECOVERY_STATE, SCOPE, SETUP_STATE, started } from './status-fixtures';

/** Keys whose string values are the holder's or a module's own words rather than codes. */
const FREE_TEXT_KEYS = new Set(['label', 'methodName', 'app']);

/** Every (key, value) pair reachable in a value. */
function entries(value: unknown, key = ''): (readonly [string, unknown])[] {
  if (Array.isArray(value)) return value.flatMap((inner) => entries(inner, key));

  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([inner, child]) => [[inner, child] as const, ...entries(child, inner)]);
  }

  return [[key, value]];
}

/** Recursively frozen copy, so a write to an input throws. */
function frozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !(value instanceof Map)) {
    for (const child of Object.values(value)) frozen(child);

    Object.freeze(value);
  }

  return value;
}

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
    expect(entries(build()).filter(([key]) => key === 'salt')).toEqual([]);
  });

  it('the setup description never carries a supplied salt value', () => {
    expect(serialize(descriptions.setup()).toLowerCase()).not.toContain(SUPPLIED_SALT.slice(2));
  });

  it.each(['approval', 'cancellation'] as const)('the %s description never carries the request\'s salt', (name) => {
    const request = name === 'approval' ? approval : cancellation;

    expect(serialize(descriptions[name]()).toLowerCase()).not.toContain(request.salt.slice(2).toLowerCase());
  });

  it.each(Object.entries(descriptions))('the %s description holds no sentence outside labels and self-stated names', (_name, build) => {
    const sentences = entries(build()).filter(
      ([key, value]) => typeof value === 'string' && !FREE_TEXT_KEYS.has(key) && /\s/.test(value),
    );

    expect(sentences).toEqual([]);
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
