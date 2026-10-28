import { describe, expect, it } from 'vitest';
import {
  CLIENT_CORE_NO_SETUP_COMMITMENT,
  CLIENT_CORE_SIMULATION_FROM,
  FORMATS_ZERO_ADDRESS,
  KitRefusalError,
  type KitRefusalDetails,
  type RestoreCause,
  type ValidationResult,
} from '../../src/index';
import { ACCOUNT, ACTION, ZERO_ADDRESS, ZERO_WORD } from './support';

const FINDINGS: ValidationResult = { errors: [], warnings: [] };

const CAUSE: RestoreCause = {
  code: 'restore.no-backup',
  subject: 'restore',
  values: { account: ACCOUNT, action: ACTION, case: 'no-setup' },
};

describe('KitRefusalError', () => {
  it('is an Error and a KitRefusalError with its own name and the given message', () => {
    const error = new KitRefusalError('refused');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(KitRefusalError);
    expect(error.name).toBe('KitRefusalError');
    expect(error.message).toBe('refused');
    expect(String(error)).toBe('KitRefusalError: refused');
    expect(typeof error.stack).toBe('string');
  });

  it('carries neither findings nor a restore cause when none is given', () => {
    const error = new KitRefusalError('refused');

    expect(error.findings).toBeUndefined();
    expect(error.restoreCause).toBeUndefined();
    expect(Object.keys(error)).not.toContain('findings');
    expect(Object.keys(error)).not.toContain('restoreCause');
  });

  it('carries the findings when given, and no restore cause', () => {
    const error = new KitRefusalError('invalid setup', { findings: FINDINGS });

    expect(error.findings).toBe(FINDINGS);
    expect(error.restoreCause).toBeUndefined();
  });

  it('carries the restore cause when given, and no findings', () => {
    const error = new KitRefusalError('nothing to restore', { restoreCause: CAUSE });

    expect(error.restoreCause).toBe(CAUSE);
    expect(error.findings).toBeUndefined();
  });

  it('carries both when both are given', () => {
    const details: KitRefusalDetails = { findings: FINDINGS, restoreCause: CAUSE };
    const error = new KitRefusalError('both', details);

    expect(error.findings).toBe(FINDINGS);
    expect(error.restoreCause).toBe(CAUSE);
  });

  it.each([
    ['no details', undefined],
    ['findings', { findings: FINDINGS }],
    ['a restore cause', { restoreCause: CAUSE }],
  ] as const)('never sets the standard cause, with %s', (_, details) => {
    const error = new KitRefusalError('refused', details);

    expect(Object.hasOwn(error, 'cause')).toBe(false);
    expect(error.cause).toBeUndefined();
    expect('cause' in error).toBe(false);
  });

  it('can be caught as an Error and told apart by instanceof', () => {
    const thrower = (): never => {
      throw new KitRefusalError('refused', { restoreCause: CAUSE });
    };

    try {
      thrower();
    } catch (error) {
      expect(error instanceof KitRefusalError && error.restoreCause?.code).toBe('restore.no-backup');
    }

    expect.assertions(1);
  });
});

describe('client-core constants', () => {
  it('runs a permissionless simulation from the zero address', () => {
    expect(CLIENT_CORE_SIMULATION_FROM).toBe(ZERO_ADDRESS);
    expect(CLIENT_CORE_SIMULATION_FROM).toBe(FORMATS_ZERO_ADDRESS);
  });

  it('reads no setup as the zero word', () => {
    expect(CLIENT_CORE_NO_SETUP_COMMITMENT).toBe(ZERO_WORD);
  });
});
