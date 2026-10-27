import { describe, expect, it } from 'vitest';
import { SETUP_ERROR_CODES, validateSetup, type SetupValidationContext } from '../../src/index';
import { ACCOUNT, ACTION, CONFIGURATION, DRAFT, OTHER_IMPLEMENTATION, SERVED_IMPLEMENTATION, SETUP_CONTEXT } from './fixtures';

/** The fixture context with the account's code read and the action's fit answer replaced. */
const withAccount = (accountHoldsCode: boolean, supportsAccount: boolean, extra: Partial<SetupValidationContext> = {}): SetupValidationContext => ({
  ...SETUP_CONTEXT,
  action: { ...SETUP_CONTEXT.action, accountHoldsCode, supportsAccount },
  ...extra,
});

const NOT_DEPLOYED = {
  code: 'account.not-deployed',
  subject: 'account',
  values: { account: ACCOUNT, servedImplementation: SERVED_IMPLEMENTATION },
} as const;

describe('account.not-deployed', () => {
  it('is a setup error placed right after action.unsupported', () => {
    expect(SETUP_ERROR_CODES).toContain('account.not-deployed');
    expect(SETUP_ERROR_CODES.indexOf('account.not-deployed')).toBe(SETUP_ERROR_CODES.indexOf('action.unsupported') + 1);
  });

  it.each([
    ['says yes', true],
    ['says no', false],
  ] as const)('a code-less account gets exactly that error, and no action.unsupported where the action %s', (_case, supportsAccount) => {
    expect(validateSetup(DRAFT, withAccount(false, supportsAccount))).toEqual({ errors: [NOT_DEPLOYED], warnings: [] });
  });

  it('names the implementation the configuration names, beside the served one', () => {
    const context = withAccount(false, false, { configuration: { ...CONFIGURATION, accountImplementation: OTHER_IMPLEMENTATION } });

    expect(validateSetup(DRAFT, context).errors).toEqual([
      { ...NOT_DEPLOYED, values: { ...NOT_DEPLOYED.values, accountImplementation: OTHER_IMPLEMENTATION } },
    ]);
  });

  it('names the account checksummed from a lower-case spelling, as the other findings do', () => {
    const mixed = '0x52908400098527886E0F7030069857D2E4169EE7' as const;
    const result = validateSetup(DRAFT, withAccount(false, true, { account: mixed.toLowerCase() as typeof mixed }));

    expect(result.errors.map((finding) => finding.code)).toEqual(['account.not-deployed']);
    expect(result.errors[0]?.values).toMatchObject({ account: mixed });
  });

  it('leaves action.unaudited as it was on a code-less account', () => {
    const context = withAccount(false, false, { descriptor: { ...SETUP_CONTEXT.descriptor, auditedActions: [] } });
    const result = validateSetup(DRAFT, context);

    expect(result.errors).toEqual([NOT_DEPLOYED]);
    expect(result.warnings.map((finding) => finding.code)).toEqual(['action.unaudited']);
    expect(result.warnings[0]?.values).toMatchObject({ action: ACTION });
  });

  it('an account holding code behaves as before: action.unsupported on a no, nothing on a yes', () => {
    expect(validateSetup(DRAFT, withAccount(true, true))).toEqual({ errors: [], warnings: [] });
    expect(validateSetup(DRAFT, withAccount(true, false)).errors.map((finding) => finding.code)).toEqual(['action.unsupported']);
  });

  it.each([
    ['missing', undefined],
    ['a string', 'false'],
    ['a number', 0],
    ['null', null],
  ] as const)('a %s accountHoldsCode is a TypeError, never a finding', (_case, value) => {
    const rest: { [member: string]: unknown } = { ...SETUP_CONTEXT.action };

    delete rest['accountHoldsCode'];

    const action = value === undefined ? rest : { ...rest, accountHoldsCode: value };

    expect(() => validateSetup(DRAFT, { ...SETUP_CONTEXT, action } as never)).toThrow(TypeError);
  });
});
