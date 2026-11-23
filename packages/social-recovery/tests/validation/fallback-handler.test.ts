import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { SETUP_WARNING_CODES, validateSetup, type Address, type Hex, type ReadResult, type SetupValidationContext } from '../../src/index';
import { ACCOUNT, DRAFT, OTHER_ACTION, SETUP_CONTEXT, credential, ECDSA, PASSKEY, withClauses } from './fixtures';

const SLOT: Address = '0x0000000000000000000000000000000000006969';

/** A handler address with letters, so its checksum is not its lower-case spelling. */
const HANDLER = getAddress('0xabcdef0123456789abcdef0123456789abcd6969');
const HANDLER_WORD: Hex = `0x${'00'.repeat(12)}${HANDLER.slice(2).toLowerCase()}`;
const UPPER_ONLY_WORD: Hex = `0x${'ff'.repeat(12)}${'00'.repeat(20)}`;

/** The fixture context with the account's handler word read as given, or not read at all. */
const withEntry = (entry?: ReadResult<Hex>, extra: Partial<SetupValidationContext> = {}): SetupValidationContext => ({
  ...SETUP_CONTEXT,
  action: { ...SETUP_CONTEXT.action, ...(entry === undefined ? {} : { fallbackHandlerEntry: entry }) },
  ...extra,
});

const answered = (word: Hex): ReadResult<Hex> => ({ answered: true, value: word });

describe('account.fallback-handler', () => {
  it('is a setup warning placed right after manager.already-armed', () => {
    expect(SETUP_WARNING_CODES.indexOf('account.fallback-handler')).toBe(SETUP_WARNING_CODES.indexOf('manager.already-armed') + 1);
  });

  it('warns once on an installed handler, subject account, naming the account, the slot, the word and the handler', () => {
    expect(validateSetup(DRAFT, withEntry(answered(HANDLER_WORD)))).toEqual({
      errors: [],
      warnings: [{ code: 'account.fallback-handler', subject: 'account', values: { account: ACCOUNT, slot: SLOT, entry: HANDLER_WORD, handler: HANDLER } }],
    });
  });

  it('warns on a word whose low 20 bytes are zero, naming no handler', () => {
    const [warning] = validateSetup(DRAFT, withEntry(answered(UPPER_ONLY_WORD))).warnings;

    expect(warning).toStrictEqual({ code: 'account.fallback-handler', subject: 'account', values: { account: ACCOUNT, slot: SLOT, entry: UPPER_ONLY_WORD } });
  });

  it('names the word lower-cased and the account checksummed from other spellings', () => {
    const mixed = '0x52908400098527886E0F7030069857D2E4169EE7' as const;
    const upper = `0x${HANDLER_WORD.slice(2).toUpperCase()}` as Hex;
    const [warning] = validateSetup(DRAFT, withEntry(answered(upper), { account: mixed.toLowerCase() as Address })).warnings;

    expect(warning?.values).toStrictEqual({ account: mixed, slot: SLOT, entry: HANDLER_WORD, handler: HANDLER });
  });

  it.each<[string, ReadResult<Hex> | undefined]>([
    ['an empty slot', answered(`0x${'00'.repeat(32)}`)],
    ['an unanswered read', { answered: false }],
    ['no read', undefined],
  ])('raises nothing on %s', (_name, entry) => {
    expect(validateSetup(DRAFT, withEntry(entry))).toEqual({ errors: [], warnings: [] });
  });

  it('is never an error: the errors are those of the same context without the read', () => {
    const unread: SetupValidationContext = { ...SETUP_CONTEXT, action: { ...SETUP_CONTEXT.action, supportsAccount: false } };
    const dead: SetupValidationContext = { ...unread, action: { ...unread.action, fallbackHandlerEntry: answered(HANDLER_WORD) } };

    expect(validateSetup(DRAFT, dead).errors).toEqual(validateSetup(DRAFT, unread).errors);
    expect(validateSetup(DRAFT, dead).errors.map((finding) => finding.code)).toEqual(['action.unsupported']);
  });

  it('comes after the other armed actions and before a repeated person', () => {
    const draft = withClauses([
      { threshold: 2, credentials: [credential(ECDSA, 1, { label: 'a' }), credential(PASSKEY, 2), credential(ECDSA, 3, { label: 'a' })] },
    ]);
    const armed = {
      kind: 'setup-committed' as const,
      account: ACCOUNT,
      action: OTHER_ACTION,
      nonce: 2n,
      setupCommitment: `0x${'55'.repeat(32)}` as Hex,
      publicMetadata: '0x' as Hex,
      privateMetadata: '0x' as Hex,
      at: { blockNumber: 10, blockHash: `0x${'33'.repeat(32)}` as Hex, logIndex: 0, transactionHash: `0x${'44'.repeat(32)}` as Hex, removed: false },
    };
    const result = validateSetup(draft, withEntry(answered(HANDLER_WORD), { managerEvents: [armed] }));

    const order = ['manager.already-armed', 'account.fallback-handler', 'rule.repeated-person'];

    expect(result.warnings.map((finding) => finding.code).filter((code) => order.includes(code))).toEqual(order);
  });
});
