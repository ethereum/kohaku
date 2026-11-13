import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  SETUP_ERROR_CODES,
  SETUP_WARNING_CODES,
  describeSetup,
  validateSetup,
  type Address,
  type Finding,
  type FindingValues,
  type ReadResult,
  type SetupValidationContext,
  type ValidationResult,
} from '../../src/index';
import { CONTEXT as DESCRIPTION_CONTEXT, DRAFT as DESCRIPTION_DRAFT } from '../description/setup-fixtures';
import { ACCOUNT, ACTION, CONFIGURATION, DESCRIPTOR, DRAFT, OTHER_IMPLEMENTATION, OTHER_MANAGER, SERVED_IMPLEMENTATION, SETUP_CONTEXT, ZERO } from './fixtures';

/** EIP-55 sample addresses in lower case, so a checksummed value differs from the spelling passed in. */
const LETTERED_ACCOUNT: Address = '0xd1220a0cf47c7b9be7a2e6ba89f429762e7b9adb';
const LETTERED_SERVED: Address = '0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359';
const LETTERED_OTHER: Address = '0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb';

const upper = (address: Address): Address => `0x${address.slice(2).toUpperCase()}`;

const answered = (value: Address): ReadResult<Address> => ({ answered: true, value });

/** One cell of the fit matrix: the account's code, the implementation the configuration declares, the action's own answer and its fit answer. */
type Cell = {
  readonly holdsCode: boolean;
  readonly declared: Address | undefined;
  readonly read: ReadResult<Address> | undefined;
  readonly supportsAccount: boolean;
};

/** The fixture context with the cell's reads and declaration in place. */
const contextOf = (cell: Cell, extra: Partial<SetupValidationContext> = {}): SetupValidationContext => ({
  ...SETUP_CONTEXT,
  action: {
    ...SETUP_CONTEXT.action,
    accountHoldsCode: cell.holdsCode,
    supportsAccount: cell.supportsAccount,
    ...(cell.read === undefined ? {} : { actionImplementation: cell.read }),
  },
  configuration: { ...CONFIGURATION, ...(cell.declared === undefined ? {} : { accountImplementation: cell.declared }) },
  ...extra,
});

/** The fit judgment written out from the rule: code-less and declared is judged against the action's answer, else the served one. */
function expectedOf(cell: Cell): ValidationResult {
  const named: FindingValues = cell.declared === undefined ? {} : { accountImplementation: cell.declared };

  if (cell.holdsCode) {
    if (cell.supportsAccount) return { errors: [], warnings: [] };

    const values = { action: ACTION, account: ACCOUNT, supportsAccount: false, ...named, servedImplementation: SERVED_IMPLEMENTATION };

    return { errors: [{ code: 'action.unsupported', subject: 'action', values }], warnings: [] };
  }

  if (cell.declared === undefined) {
    return { errors: [{ code: 'account.not-deployed', subject: 'account', values: { account: ACCOUNT, servedImplementation: SERVED_IMPLEMENTATION } }], warnings: [] };
  }

  const answer = cell.read?.answered === true ? cell.read.value : undefined;
  const told: FindingValues = answer === undefined ? {} : { actionImplementation: answer };

  if (cell.declared === (answer ?? SERVED_IMPLEMENTATION)) {
    const values = { account: ACCOUNT, accountImplementation: cell.declared, servedImplementation: SERVED_IMPLEMENTATION, ...told };

    return { errors: [], warnings: [{ code: 'account.deploy-pending', subject: 'account', values }] };
  }

  const values = {
    action: ACTION,
    account: ACCOUNT,
    supportsAccount: cell.supportsAccount,
    accountImplementation: cell.declared,
    servedImplementation: SERVED_IMPLEMENTATION,
    ...told,
  };

  return { errors: [{ code: 'action.unsupported', subject: 'action', values }], warnings: [] };
}

const DECLARATIONS: readonly (readonly [string, Address | undefined])[] = [
  ['none', undefined],
  ['the served one', SERVED_IMPLEMENTATION],
  ['another', OTHER_IMPLEMENTATION],
];

const READS: readonly (readonly [string, ReadResult<Address> | undefined])[] = [
  ['not read', undefined],
  ['answering the served one', answered(SERVED_IMPLEMENTATION)],
  ['answering another', answered(OTHER_IMPLEMENTATION)],
  ['unanswered', { answered: false }],
];

const MATRIX = [true, false].flatMap((holdsCode) =>
  DECLARATIONS.flatMap(([declaredName, declared]) =>
    READS.flatMap(([readName, read]) =>
      [true, false].map((supportsAccount) => [
        `${holdsCode ? 'with code' : 'code-less'}, declared ${declaredName}, action ${readName}, supportsAccount ${supportsAccount}`,
        { holdsCode, declared, read, supportsAccount },
      ] as const),
    ),
  ),
);

const deployPending = (result: ValidationResult): Finding[] => result.warnings.filter((finding) => finding.code === 'account.deploy-pending');

describe('account.deploy-pending', () => {
  it('is a setup warning placed right after account.fallback-handler, and no error', () => {
    expect(SETUP_WARNING_CODES.indexOf('account.deploy-pending')).toBe(SETUP_WARNING_CODES.indexOf('account.fallback-handler') + 1);
    expect(SETUP_ERROR_CODES as readonly string[]).not.toContain('account.deploy-pending');
  });

  it('a code-less account declared to get the implementation the action serves validates with no error and only that warning', () => {
    const cell = { holdsCode: false, declared: SERVED_IMPLEMENTATION, read: undefined, supportsAccount: false };

    expect(validateSetup(DRAFT, contextOf(cell))).toEqual({
      errors: [],
      warnings: [
        {
          code: 'account.deploy-pending',
          subject: 'account',
          values: { account: ACCOUNT, accountImplementation: SERVED_IMPLEMENTATION, servedImplementation: SERVED_IMPLEMENTATION },
        },
      ],
    });
  });

  it.each(MATRIX)('judges the fit as the rule says: %s', (_name, cell) => {
    expect(validateSetup(DRAFT, contextOf(cell))).toEqual(expectedOf(cell));
  });

  it('with code, an action read beside the fit changes nothing', () => {
    for (const [, read] of READS) {
      for (const supportsAccount of [true, false]) {
        const cell = { holdsCode: true, declared: OTHER_IMPLEMENTATION, read, supportsAccount };

        expect(validateSetup(DRAFT, contextOf(cell))).toEqual(validateSetup(DRAFT, contextOf({ ...cell, read: undefined })));
      }
    }
  });

  it('never raises account.not-deployed once an implementation is declared, nor beside action.unsupported', () => {
    for (const [, cell] of MATRIX) {
      const codes = validateSetup(DRAFT, contextOf(cell)).errors.map((finding) => finding.code);

      if (cell.declared !== undefined) expect(codes).not.toContain('account.not-deployed');

      expect(codes.filter((code) => code === 'account.not-deployed' || code === 'action.unsupported').length).toBeLessThanOrEqual(1);
    }
  });

  it("judges against the action's answer where the descriptor ships a zero served implementation", () => {
    const cell = { holdsCode: false, declared: OTHER_IMPLEMENTATION, read: answered(OTHER_IMPLEMENTATION), supportsAccount: false };
    const context = contextOf(cell, { descriptor: { ...DESCRIPTOR, servedImplementation: ZERO } });

    expect(validateSetup(DRAFT, context)).toEqual({
      errors: [],
      warnings: [
        {
          code: 'account.deploy-pending',
          subject: 'account',
          values: { account: ACCOUNT, accountImplementation: OTHER_IMPLEMENTATION, servedImplementation: ZERO, actionImplementation: OTHER_IMPLEMENTATION },
        },
      ],
    });
  });

  it('names the account and the three implementations checksummed from lower-case spellings', () => {
    const cell = { holdsCode: false, declared: LETTERED_SERVED, read: answered(LETTERED_SERVED), supportsAccount: false };
    const context = contextOf(cell, { account: LETTERED_ACCOUNT, descriptor: { ...DESCRIPTOR, servedImplementation: LETTERED_SERVED } });

    expect(deployPending(validateSetup(DRAFT, context))).toEqual([
      {
        code: 'account.deploy-pending',
        subject: 'account',
        values: {
          account: getAddress(LETTERED_ACCOUNT),
          accountImplementation: getAddress(LETTERED_SERVED),
          servedImplementation: getAddress(LETTERED_SERVED),
          actionImplementation: getAddress(LETTERED_SERVED),
        },
      },
    ]);
  });

  it('names the mismatch checksummed from lower-case spellings', () => {
    const cell = { holdsCode: false, declared: LETTERED_SERVED, read: answered(LETTERED_OTHER), supportsAccount: false };
    const context = contextOf(cell, { account: LETTERED_ACCOUNT, descriptor: { ...DESCRIPTOR, servedImplementation: LETTERED_SERVED } });

    expect(validateSetup(DRAFT, context)).toEqual({
      errors: [
        {
          code: 'action.unsupported',
          subject: 'action',
          values: {
            action: ACTION,
            account: getAddress(LETTERED_ACCOUNT),
            supportsAccount: false,
            accountImplementation: getAddress(LETTERED_SERVED),
            servedImplementation: getAddress(LETTERED_SERVED),
            actionImplementation: getAddress(LETTERED_OTHER),
          },
        },
      ],
      warnings: [],
    });
  });

  it.each<[string, Address, Address | undefined]>([
    ['a lower-case declaration of the checksummed served one', LETTERED_SERVED, undefined],
    ['an upper-case declaration of the checksummed served one', upper(LETTERED_SERVED), undefined],
    ["a checksummed declaration of a lower-case answer", getAddress(LETTERED_OTHER), LETTERED_OTHER],
    ["an upper-case declaration of a checksummed answer", upper(LETTERED_OTHER), getAddress(LETTERED_OTHER)],
  ])('matches %s', (_name, declared, answer) => {
    const cell = { holdsCode: false, declared, read: answer === undefined ? undefined : answered(answer), supportsAccount: false };
    const result = validateSetup(DRAFT, contextOf(cell, { descriptor: { ...DESCRIPTOR, servedImplementation: getAddress(LETTERED_SERVED) } }));

    expect(result.errors).toEqual([]);
    expect(deployPending(result)).toHaveLength(1);
  });

  it('comes before action.unaudited, at the fit\'s place', () => {
    const cell = { holdsCode: false, declared: SERVED_IMPLEMENTATION, read: answered(SERVED_IMPLEMENTATION), supportsAccount: false };
    const result = validateSetup(DRAFT, contextOf(cell, { descriptor: { ...DESCRIPTOR, auditedActions: [] } }));

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((finding) => finding.code)).toEqual(['account.deploy-pending', 'action.unaudited']);
  });

  it('leaves action.manager-mismatch standing beside the warning or the mismatch error', () => {
    const mismatched = { ...SETUP_CONTEXT.action, manager: answered(OTHER_MANAGER) };
    const passing = contextOf({ holdsCode: false, declared: SERVED_IMPLEMENTATION, read: undefined, supportsAccount: false });
    const failing = contextOf({ holdsCode: false, declared: OTHER_IMPLEMENTATION, read: undefined, supportsAccount: false });
    const passed = validateSetup(DRAFT, { ...passing, action: { ...passing.action, manager: mismatched.manager } });
    const failed = validateSetup(DRAFT, { ...failing, action: { ...failing.action, manager: mismatched.manager } });

    expect(passed.errors.map((finding) => finding.code)).toEqual(['action.manager-mismatch']);
    expect(passed.warnings.map((finding) => finding.code)).toEqual(['account.deploy-pending']);
    expect(failed.errors.map((finding) => finding.code)).toEqual(['action.unsupported', 'action.manager-mismatch']);
    expect(failed.warnings).toEqual([]);
  });
});

describe('a malformed actionImplementation read', () => {
  const codeLess = contextOf({ holdsCode: false, declared: SERVED_IMPLEMENTATION, read: undefined, supportsAccount: false });

  it.each<[string, unknown]>([
    ['a null read', null],
    ['a bare address in place of the read', SERVED_IMPLEMENTATION],
    ['a string read', 'answered'],
    ['a read without answered', {}],
    ['a string answered', { answered: 'yes', value: SERVED_IMPLEMENTATION }],
    ['a numeric answered', { answered: 1, value: SERVED_IMPLEMENTATION }],
    ['an answered read without a value', { answered: true }],
    ['an answered read whose value is no address', { answered: true, value: 'nope' }],
    ['an answered read whose value is 19 bytes', { answered: true, value: `0x${'40'.repeat(19)}` }],
    ['an answered read whose value is a 32-byte word', { answered: true, value: `0x${'00'.repeat(12)}${SERVED_IMPLEMENTATION.slice(2)}` }],
    ['an answered read whose value fails its checksum', { answered: true, value: '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' }],
  ])('throws a TypeError from validateSetup and describeSetup for %s', (_name, actionImplementation) => {
    const described = { ...DESCRIPTION_CONTEXT, action: { ...DESCRIPTION_CONTEXT.action, actionImplementation } } as typeof DESCRIPTION_CONTEXT;

    expect(() => validateSetup(DRAFT, { ...codeLess, action: { ...codeLess.action, actionImplementation } } as SetupValidationContext)).toThrow(TypeError);
    expect(() => validateSetup(DRAFT, { ...SETUP_CONTEXT, action: { ...SETUP_CONTEXT.action, actionImplementation } } as SetupValidationContext)).toThrow(TypeError);
    expect(() => describeSetup(DESCRIPTION_DRAFT, described)).toThrow(TypeError);
  });
});

describe('describeSetup over the actionImplementation read', () => {
  it.each<[string, ReadResult<Address>]>([
    ['the served implementation', answered(SERVED_IMPLEMENTATION)],
    ['another implementation', answered(OTHER_IMPLEMENTATION)],
    ['nothing', { answered: false }],
  ])('describes a code-less account whose action answers %s as it describes one never read', (_name, actionImplementation) => {
    const bare = { ...DESCRIPTION_CONTEXT, action: { ...DESCRIPTION_CONTEXT.action, accountHoldsCode: false } };
    const read = { ...bare, action: { ...bare.action, actionImplementation } };
    const description = describeSetup(DESCRIPTION_DRAFT, read);

    expect(description).toEqual(describeSetup(DESCRIPTION_DRAFT, bare));
    expect('actionImplementation' in description.action).toBe(false);
    expect('supportsAccount' in description.action).toBe(false);
  });
});
