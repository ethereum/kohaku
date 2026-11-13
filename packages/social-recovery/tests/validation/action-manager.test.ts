import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { SETUP_ERROR_CODES, describeSetup, validateSetup, type Address, type ReadResult, type SetupValidationContext } from '../../src/index';
import { CONTEXT as DESCRIPTION_CONTEXT, DRAFT as DESCRIPTION_DRAFT } from '../description/setup-fixtures';
import { ACTION, DESCRIPTOR, DRAFT, OTHER_MANAGER, SETUP_CONTEXT } from './fixtures';

/** EIP-55 sample addresses in lower case, so a checksummed value differs from the spelling passed in. */
const LETTERED_MANAGER: Address = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
const LETTERED_ACTION: Address = '0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359';
const LETTERED_OTHER: Address = '0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb';

/** The fixture context with the action's `MANAGER()` read and any other action read replaced. */
const withManager = (manager: unknown, extra: Partial<SetupValidationContext['action']> = {}): SetupValidationContext =>
  ({ ...SETUP_CONTEXT, action: { ...SETUP_CONTEXT.action, ...extra, manager } }) as SetupValidationContext;

const answered = (value: Address): ReadResult<Address> => ({ answered: true, value });

const MISMATCH = {
  code: 'action.manager-mismatch',
  subject: 'action',
  values: { action: ACTION, manager: DESCRIPTOR.manager, actionManager: OTHER_MANAGER },
} as const;

const codesOf = (context: SetupValidationContext) => validateSetup(DRAFT, context).errors.map((finding) => finding.code);

describe('action.manager-mismatch', () => {
  it('is a setup error placed right after account.not-deployed', () => {
    expect(SETUP_ERROR_CODES.indexOf('action.manager-mismatch')).toBe(SETUP_ERROR_CODES.indexOf('account.not-deployed') + 1);
  });

  it('is the one error of an audited action whose MANAGER() names another manager, and it is no warning', () => {
    expect(SETUP_CONTEXT.descriptor.auditedActions).toContain(ACTION);
    expect(validateSetup(DRAFT, withManager(answered(OTHER_MANAGER)))).toEqual({ errors: [MISMATCH], warnings: [] });
  });

  it('names the action, the descriptor manager and the answer, each checksummed from a lower-case spelling', () => {
    const context: SetupValidationContext = {
      ...withManager(answered(LETTERED_OTHER), { address: LETTERED_ACTION }),
      descriptor: { ...DESCRIPTOR, manager: LETTERED_MANAGER, auditedActions: [LETTERED_ACTION] },
    };

    expect(validateSetup(DRAFT, context).errors).toEqual([
      { ...MISMATCH, values: { action: getAddress(LETTERED_ACTION), manager: getAddress(LETTERED_MANAGER), actionManager: getAddress(LETTERED_OTHER) } },
    ]);
  });

  it.each([
    ['checksummed', getAddress(LETTERED_MANAGER)],
    ['in lower case', LETTERED_MANAGER],
    ['in upper case', `0x${LETTERED_MANAGER.slice(2).toUpperCase()}` as Address],
  ] as const)("raises nothing where MANAGER() names the descriptor's manager %s", (_spelling, value) => {
    for (const manager of [LETTERED_MANAGER, getAddress(LETTERED_MANAGER)]) {
      const context: SetupValidationContext = { ...withManager(answered(value)), descriptor: { ...DESCRIPTOR, manager } };

      expect(validateSetup(DRAFT, context)).toEqual({ errors: [], warnings: [] });
    }
  });

  it('raises nothing where MANAGER() went unanswered, whatever the descriptor names', () => {
    expect(validateSetup(DRAFT, withManager({ answered: false }))).toEqual(validateSetup(DRAFT, SETUP_CONTEXT));
    expect(validateSetup(DRAFT, withManager({ answered: false }))).toEqual({ errors: [], warnings: [] });
  });

  it.each([
    ['the action does not serve the account', { supportsAccount: false }, 'action.unsupported'],
    ['the account holds no code', { accountHoldsCode: false }, 'account.not-deployed'],
  ] as const)('stands beside the fit error, right after it, where %s', (_case, extra, fit) => {
    const codes = codesOf(withManager(answered(OTHER_MANAGER), extra));

    expect(codes).toContain(fit);
    expect(codes.filter((code) => code === 'action.manager-mismatch')).toHaveLength(1);
    expect(codes.indexOf('action.manager-mismatch')).toBe(codes.indexOf(fit) + 1);
  });

  it('stands beside action.unaudited for an unaudited action', () => {
    const context: SetupValidationContext = { ...withManager(answered(OTHER_MANAGER)), descriptor: { ...DESCRIPTOR, auditedActions: [] } };
    const result = validateSetup(DRAFT, context);

    expect(result.errors).toEqual([MISMATCH]);
    expect(result.warnings.map((finding) => finding.code)).toEqual(['action.unaudited']);
  });
});

describe('a malformed MANAGER() read', () => {
  it.each<[string, unknown]>([
    ['a missing read', undefined],
    ['a null read', null],
    ['a bare address in place of the read', OTHER_MANAGER],
    ['a read without answered', {}],
    ['a string answered', { answered: 'yes', value: OTHER_MANAGER }],
    ['a numeric answered', { answered: 1, value: OTHER_MANAGER }],
    ['an answered read without a value', { answered: true }],
    ['an answered read whose value is no address', { answered: true, value: 'nope' }],
    ['an answered read whose value is 19 bytes', { answered: true, value: `0x${'80'.repeat(19)}` }],
    ['an answered read whose value fails its checksum', { answered: true, value: '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' }],
  ])('throws a TypeError from validateSetup and describeSetup for %s', (_name, manager) => {
    const described = { ...DESCRIPTION_CONTEXT, action: { ...DESCRIPTION_CONTEXT.action, manager } } as typeof DESCRIPTION_CONTEXT;

    expect(() => validateSetup(DRAFT, withManager(manager))).toThrow(TypeError);
    expect(() => describeSetup(DESCRIPTION_DRAFT, described)).toThrow(TypeError);
  });
});

describe('describeSetup over the MANAGER() read', () => {
  it.each<[string, ReadResult<Address>]>([
    ['another manager', answered(OTHER_MANAGER)],
    ['nothing', { answered: false }],
  ])('describes an action answering %s as it describes the paired one', (_name, manager) => {
    const context = { ...DESCRIPTION_CONTEXT, action: { ...DESCRIPTION_CONTEXT.action, manager } };
    const description = describeSetup(DESCRIPTION_DRAFT, context);

    expect(description).toEqual(describeSetup(DESCRIPTION_DRAFT, DESCRIPTION_CONTEXT));
    expect('manager' in description.action).toBe(false);
  });
});
