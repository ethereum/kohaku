import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Hex, SetupDescription, ValidationResult } from '../../src/index';
import {
  ACCOUNT,
  answeringHandler,
  build,
  type BuildOptions,
  DRAFT,
  HANDLER_READ_DATA,
  HANDLER_SLOT,
  OTHER_ACTION,
  PIN,
  revert,
  transportFailure,
  ZERO_WORD,
} from './doubles';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** A handler address with letters, so its checksum is not its lower-case spelling. */
const HANDLER = getAddress('0xabcdef0123456789abcdef0123456789abcd6969');

/** The handler as the account stores it: the address in the low 20 bytes of the word. */
const HANDLER_WORD: Hex = `0x${'00'.repeat(12)}${HANDLER.slice(2).toLowerCase()}`;

const MEMBERS = ['describeSetup', 'validateSetup'] as const;

/** The calls the client sent the provider for the account, addresses and data lower-cased; the action's `MANAGER()` call is not one. */
const callsOf = (seen: ReturnType<typeof build>['seen']) =>
  seen.calls
    .map((call) => ({ ...call, to: call.to.toLowerCase(), data: call.data.toLowerCase() }))
    .filter((call) => call.to === ACCOUNT.toLowerCase());

const handlerWarnings = (result: ValidationResult) => result.warnings.filter((finding) => finding.code === 'account.fallback-handler');

/** Runs one utility on a fresh client, returning what it answered and what the doubles saw. */
async function judged(member: (typeof MEMBERS)[number], options: BuildOptions = {}) {
  const made = build(options);
  const answered: SetupDescription | ValidationResult = await made.client[member](DRAFT);

  return { ...made, answered };
}

describe("the account's fallback handler read", () => {
  it.each(MEMBERS)('%s makes exactly one call, to the account, for privileges(0x…6969) from the zero address at the pinned block', async (member) => {
    const { seen } = await judged(member);

    expect(callsOf(seen)).toEqual([{ to: ACCOUNT.toLowerCase(), data: HANDLER_READ_DATA, from: ZERO_ADDRESS, block: PIN.number }]);
    expect(seen.codes).toHaveLength(1);
  });

  it('calls privileges(address), selector 0xc066a5b1, with the slot left-padded to one word', () => {
    expect(HANDLER_READ_DATA).toBe(`0xc066a5b1${'0'.repeat(24)}${HANDLER_SLOT.slice(2)}`);
  });

  it.each<[string, BuildOptions]>([
    ['the account holds no code', { world: { code: '0x' } }],
    ['the action does not serve the account', { world: { supportsAccount: false } }],
    ["the bound action is not the deployment's", { action: OTHER_ACTION }],
  ])('makes no call to the account where %s, and discloses no handler', async (_name, options) => {
    for (const member of MEMBERS) {
      const { seen, answered } = await judged(member, { ...options, world: { ...options.world, simulate: answeringHandler(HANDLER_WORD) } });

      expect(callsOf(seen), member).toEqual([]);
      expect(seen.codes, member).toHaveLength(1);

      if (member === 'describeSetup') expect('fallbackHandler' in answered).toBe(false);
      else expect(handlerWarnings(answered as ValidationResult)).toEqual([]);
    }
  });
});

describe('a failed handler read', () => {
  it.each<[string, Parameters<typeof answeringHandler>[0]]>([
    ['a provider revert', { rejects: revert('0x') }],
    ['a provider revert with data', { rejects: revert('0x08c379a0') }],
    ['a transport failure', { rejects: transportFailure() }],
    ['an empty answer', '0x'],
    ['an answer of 31 bytes', `0x${'ab'.repeat(31)}`],
    ['an answer of 33 bytes', `0x${'ab'.repeat(33)}`],
    ['an answer of 20 bytes', `0x${'ab'.repeat(20)}`],
    ['an answer that is not hex', 'nope' as Hex],
  ])('reads %s as unanswered in the description and raises no warning, both utilities still resolving', async (_name, word) => {
    const options = { world: { simulate: answeringHandler(word) } };
    const description = (await judged('describeSetup', options)).answered as SetupDescription;
    const validation = (await judged('validateSetup', options)).answered as ValidationResult;

    expect(description.fallbackHandler).toStrictEqual({ answered: false });
    expect(handlerWarnings(validation)).toEqual([]);
  });

  it("reads the doubles' default answer, 0x, as unanswered", async () => {
    expect(((await judged('describeSetup')).answered as SetupDescription).fallbackHandler).toStrictEqual({ answered: false });
  });
});

describe('an installed handler, which a recovery leaves in place, is disclosed before the setup is committed', () => {
  it("describeSetup names the handler's actual stored address and validateSetup warns about it", async () => {
    const options = { world: { simulate: answeringHandler(HANDLER_WORD) } };
    const description = (await judged('describeSetup', options)).answered as SetupDescription;
    const validation = (await judged('validateSetup', options)).answered as ValidationResult;

    expect(description.fallbackHandler).toStrictEqual({ answered: true, value: { entry: HANDLER_WORD, handler: HANDLER } });
    expect(handlerWarnings(validation)).toEqual([
      { code: 'account.fallback-handler', subject: 'account', values: { account: ACCOUNT, slot: HANDLER_SLOT, entry: HANDLER_WORD, handler: HANDLER } },
    ]);
    expect(validation.errors).toEqual([]);
  });

  it('lower-cases a word the node answers in upper case', async () => {
    const upper = `0x${HANDLER_WORD.slice(2).toUpperCase()}` as Hex;
    const options = { world: { simulate: answeringHandler(upper) } };
    const description = (await judged('describeSetup', options)).answered as SetupDescription;
    const [warning] = handlerWarnings((await judged('validateSetup', options)).answered as ValidationResult);

    expect(description.fallbackHandler).toStrictEqual({ answered: true, value: { entry: HANDLER_WORD, handler: HANDLER } });
    expect(warning?.values).toMatchObject({ entry: HANDLER_WORD, handler: HANDLER });
  });

  it('describes an empty slot as an answered zero word with no handler, and raises no warning', async () => {
    const options = { world: { simulate: answeringHandler(ZERO_WORD) } };
    const description = (await judged('describeSetup', options)).answered as SetupDescription;
    const validation = (await judged('validateSetup', options)).answered as ValidationResult;

    expect(description.fallbackHandler).toStrictEqual({ answered: true, value: { entry: ZERO_WORD } });
    expect(handlerWarnings(validation)).toEqual([]);
  });
});
