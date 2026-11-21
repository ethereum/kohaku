import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { describeSetup, validateSetup, type Address, type ReadResult, type SetupValidationContext } from '../../src/index';
import { CONTEXT as DESCRIPTION_CONTEXT, DRAFT as DESCRIPTION_DRAFT } from '../description/setup-fixtures';
import { TIMEOUT, run } from '../formats/arbitraries';
import { CONFIGURATION, DESCRIPTOR, DRAFT, SETUP_CONTEXT } from './fixtures';

/** Three lettered implementations, drawn from so often that declared, served and answered coincide in many runs. */
const POOL: readonly Address[] = [
  '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
  '0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359',
  '0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb',
];

/** One of the pool in lower case, upper case or checksummed. */
const spelled: fc.Arbitrary<Address> = fc
  .tuple(fc.constantFrom(...POOL), fc.constantFrom('lower', 'upper', 'checksum'))
  .map(([address, spelling]): Address => {
    if (spelling === 'upper') return `0x${address.slice(2).toUpperCase()}`;

    return spelling === 'checksum' ? getAddress(address) : address;
  });

/** No read, an unanswered read, or an answer from the pool. */
const reads: fc.Arbitrary<ReadResult<Address> | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant({ answered: false as const }),
  spelled.map((value) => ({ answered: true as const, value })),
);

const cells = fc.record({
  holdsCode: fc.boolean(),
  supportsAccount: fc.boolean(),
  declared: fc.option(spelled, { nil: undefined }),
  served: spelled,
  read: reads,
});

const same = (left: Address, right: Address): boolean => left.toLowerCase() === right.toLowerCase();

describe('the code-less fit properties', () => {
  it(
    'raises exactly the fit finding the rule names, and describes the action as it would without the read',
    () => {
      run(
        fc.property(cells, ({ holdsCode, supportsAccount, declared, served, read }) => {
          const context: SetupValidationContext = {
            ...SETUP_CONTEXT,
            descriptor: { ...DESCRIPTOR, servedImplementation: served },
            configuration: { ...CONFIGURATION, ...(declared === undefined ? {} : { accountImplementation: declared }) },
            action: { ...SETUP_CONTEXT.action, accountHoldsCode: holdsCode, supportsAccount, ...(read === undefined ? {} : { actionImplementation: read }) },
          };
          const result = validateSetup(DRAFT, context);
          const codes = [...result.errors, ...result.warnings].map((finding) => finding.code);
          const expected = read?.answered === true ? read.value : served;
          const fit = (() => {
            if (holdsCode) return supportsAccount ? [] : ['action.unsupported'];

            if (declared === undefined) return ['account.not-deployed'];

            return same(declared, expected) ? ['account.deploy-pending'] : ['action.unsupported'];
          })();

          expect(codes).toEqual(fit);

          const finding = [...result.errors, ...result.warnings][0];

          if (!holdsCode && declared !== undefined && finding !== undefined) {
            expect(finding.values['accountImplementation']).toBe(getAddress(declared));
            expect(finding.values['servedImplementation']).toBe(getAddress(served));
            expect(finding.values['actionImplementation']).toBe(read?.answered === true ? getAddress(read.value) : undefined);
            expect('actionImplementation' in finding.values).toBe(read?.answered === true);
          }

          const described = { ...DESCRIPTION_CONTEXT, action: { ...DESCRIPTION_CONTEXT.action, accountHoldsCode: holdsCode, supportsAccount } };
          const withRead = { ...described, action: { ...described.action, ...(read === undefined ? {} : { actionImplementation: read }) } };

          expect(describeSetup(DESCRIPTION_DRAFT, withRead)).toEqual(describeSetup(DESCRIPTION_DRAFT, described));
        }),
      );
    },
    TIMEOUT,
  );
});
