import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { describeSetup, validateSetup, type Hex } from '../../src/index';
import { CONTEXT as DESCRIPTION_CONTEXT, DRAFT as DESCRIPTION_DRAFT } from '../description/setup-fixtures';
import { bytesN, run, TIMEOUT } from '../formats/arbitraries';
import { DRAFT, SETUP_CONTEXT } from './fixtures';

const ZERO_DIGITS = (bytes: number): string => '00'.repeat(bytes);

/** Any 32-byte word, with the zero word, an empty low part and an empty upper part each drawn often, in either letter case. */
const words: fc.Arbitrary<Hex> = fc
  .tuple(
    fc.oneof(bytesN(32), fc.constant(`0x${ZERO_DIGITS(32)}` as Hex), bytesN(12).map((upper): Hex => `${upper}${ZERO_DIGITS(20)}`), bytesN(20).map((low): Hex => `0x${ZERO_DIGITS(12)}${low.slice(2)}`)),
    fc.boolean(),
  )
  .map(([word, upper]) => (upper ? (`0x${word.slice(2).toUpperCase()}` as Hex) : word));

describe('account.fallback-handler properties', () => {
  it(
    'warns exactly when the word is not zero, and names the handler the description names',
    () => {
      run(
        fc.property(words, (word) => {
          const entry = { answered: true as const, value: word };
          const warnings = validateSetup(DRAFT, { ...SETUP_CONTEXT, action: { ...SETUP_CONTEXT.action, fallbackHandlerEntry: entry } }).warnings.filter(
            (finding) => finding.code === 'account.fallback-handler',
          );
          const described = describeSetup(DESCRIPTION_DRAFT, { ...DESCRIPTION_CONTEXT, action: { ...DESCRIPTION_CONTEXT.action, fallbackHandlerEntry: entry } }).fallbackHandler;
          const nonzero = BigInt(word) !== 0n;
          const low = BigInt(word) & ((1n << 160n) - 1n);

          expect(warnings).toHaveLength(nonzero ? 1 : 0);
          expect(described?.answered).toBe(true);

          if (described?.answered !== true) return;

          expect(described.value.entry).toBe(word.toLowerCase());
          expect('handler' in described.value).toBe(low !== 0n);
          expect(described.value.handler?.toLowerCase()).toBe(low === 0n ? undefined : `0x${low.toString(16).padStart(40, '0')}`);

          if (!nonzero) return;

          const values = warnings[0]?.values ?? {};

          expect(values['handler']).toBe(described.value.handler);
          expect('handler' in values).toBe('handler' in described.value);
          expect(values['entry']).toBe(described.value.entry);
        }),
      );
    },
    TIMEOUT,
  );
});
