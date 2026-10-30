import { describe, expect, it } from 'vitest';
import { describeRequest, type ApproverRequest } from '../../src/index';
import { approvalFromVector, cancellationFromVector, codecRegistry, describingMethod, methodRegistry } from './request-fixtures';

const approval = approvalFromVector();
const cancellation = cancellationFromVector();

/** Describes a request with one field replaced, or removed for `undefined`, and reports what describe saw. */
function attempt(base: ApproverRequest, field: string, value: unknown): { readonly error: unknown; readonly describeCalls: number } {
  const changed: Record<string, unknown> = { ...base, [field]: value };

  if (value === undefined) delete changed[field];

  const { method, seen } = describingMethod({ kind: 'external-proving-app' });

  try {
    describeRequest(changed as ApproverRequest, codecRegistry(), methodRegistry([[base.method, method]]));
  } catch (error) {
    return { error, describeCalls: seen.length };
  }

  return { error: undefined, describeCalls: seen.length };
}

describe('describeRequest refuses a digest version that is not a decimal string', () => {
  it.each<readonly [string, unknown]>([
    ['missing', undefined],
    ['empty', ''],
    ['a word', 'v1'],
    ['a decimal fraction', '1.0'],
    ['negative', '-1'],
    ['a number', 1],
  ])('throws a TypeError for a digest version %s', (_case, value) => {
    for (const base of [approval, cancellation]) {
      const { error, describeCalls } = attempt(base, 'digestVersion', value);

      expect(error).toBeInstanceOf(TypeError);
      expect(describeCalls).toBe(0);
    }
  });

  it('still describes the blessed rows under digest version 1', () => {
    expect(attempt(approval, 'digestVersion', '1').error).toBeUndefined();
    expect(attempt(cancellation, 'digestVersion', '1').error).toBeUndefined();
  });
});

describe('describeRequest checks what the ctx carries before any method sees it', () => {
  it.each<readonly [string, unknown]>([
    ['a string', 'yes'],
    ['missing', undefined],
    ['a number', 1],
  ])('throws a TypeError for credentialHoldsCode %s, calling no describe', (_case, value) => {
    const { error, describeCalls } = attempt(approval, 'credentialHoldsCode', value);

    expect(error).toBeInstanceOf(TypeError);
    expect(describeCalls).toBe(0);
  });

  it.each<readonly [string, unknown]>([
    ['not hex', `0x${'zz'.repeat(32)}`],
    ['31 bytes', `0x${'aa'.repeat(31)}`],
    ['33 bytes', `0x${'aa'.repeat(33)}`],
    ['missing', undefined],
  ])('throws a TypeError for a salt %s, calling no describe', (_case, value) => {
    for (const base of [approval, cancellation]) {
      const { error, describeCalls } = attempt(base, 'salt', value);

      expect(error).toBeInstanceOf(TypeError);
      expect(describeCalls).toBe(0);
    }
  });

  it('accepts credentialHoldsCode true and false with a 32-byte salt', () => {
    expect(attempt(approval, 'credentialHoldsCode', true).describeCalls).toBe(1);
    expect(attempt(approval, 'credentialHoldsCode', false).describeCalls).toBe(1);
  });
});
