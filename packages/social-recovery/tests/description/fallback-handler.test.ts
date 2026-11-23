import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { describeSetup, type DescribedFallbackHandler, type Hex, type ReadResult, type SetupDescriptionContext } from '../../src/index';
import { CONTEXT, DRAFT } from './setup-fixtures';

/** A handler address with letters, so its checksum is not its lower-case spelling. */
const HANDLER = getAddress('0xabcdef0123456789abcdef0123456789abcd6969');
const HANDLER_DIGITS = HANDLER.slice(2).toLowerCase();
const ZERO_WORD: Hex = `0x${'00'.repeat(32)}`;

/** The context with the account's handler word read as given, or not read at all. */
const withEntry = (entry?: ReadResult<Hex>): SetupDescriptionContext => ({
  ...CONTEXT,
  action: { ...CONTEXT.action, ...(entry === undefined ? {} : { fallbackHandlerEntry: entry }) },
});

const describedFrom = (word: Hex) => describeSetup(DRAFT, withEntry({ answered: true, value: word })).fallbackHandler;

describe('describeSetup: the fallback handler', () => {
  it.each<[string, Hex, DescribedFallbackHandler]>([
    ['the zero word: no handler', ZERO_WORD, { entry: ZERO_WORD }],
    ['a handler in the low 20 bytes', `0x${'00'.repeat(12)}${HANDLER_DIGITS}`, { entry: `0x${'00'.repeat(12)}${HANDLER_DIGITS}`, handler: HANDLER }],
    [
      'upper and low bytes set: the full word, the low 20 bytes as handler',
      `0x${'ff'.repeat(12)}${HANDLER_DIGITS}`,
      { entry: `0x${'ff'.repeat(12)}${HANDLER_DIGITS}`, handler: HANDLER },
    ],
    ['upper bytes alone: the word, no handler', `0x${'ff'.repeat(12)}${'00'.repeat(20)}`, { entry: `0x${'ff'.repeat(12)}${'00'.repeat(20)}` }],
    ['the top bit alone', `0x80${'00'.repeat(31)}`, { entry: `0x80${'00'.repeat(31)}` }],
    ['the lowest upper byte alone', `0x${'00'.repeat(11)}01${'00'.repeat(20)}`, { entry: `0x${'00'.repeat(11)}01${'00'.repeat(20)}` }],
    [
      'the highest low byte alone',
      `0x${'00'.repeat(12)}01${'00'.repeat(19)}`,
      { entry: `0x${'00'.repeat(12)}01${'00'.repeat(19)}`, handler: '0x0100000000000000000000000000000000000000' },
    ],
    ['the lowest bit alone', `0x${'00'.repeat(31)}01`, { entry: `0x${'00'.repeat(31)}01`, handler: '0x0000000000000000000000000000000000000001' }],
    [
      'an upper-case word, lower-cased',
      `0x${'00'.repeat(12)}${HANDLER_DIGITS.toUpperCase()}`,
      { entry: `0x${'00'.repeat(12)}${HANDLER_DIGITS}`, handler: HANDLER },
    ],
  ])('an answered read of %s', (_name, word, expected) => {
    expect(describedFrom(word)).toStrictEqual({ answered: true, value: expected });
  });

  it('keeps an unanswered read as unanswered', () => {
    expect(describeSetup(DRAFT, withEntry({ answered: false })).fallbackHandler).toStrictEqual({ answered: false });
  });

  it('leaves the key out where the handler was not read', () => {
    expect('fallbackHandler' in describeSetup(DRAFT, withEntry())).toBe(false);
  });

  it('adds the one key and changes nothing else in the description', () => {
    const { fallbackHandler, ...rest } = describeSetup(DRAFT, withEntry({ answered: true, value: `0x${'00'.repeat(12)}${HANDLER_DIGITS}` }));

    expect(fallbackHandler).toBeDefined();
    expect(rest).toStrictEqual(describeSetup(DRAFT, withEntry()));
  });
});
