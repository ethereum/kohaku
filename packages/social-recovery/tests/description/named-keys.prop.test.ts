import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { describeSetup, zkPassportVersionWord, type Hex, type Parties, type ReadResult } from '../../src/index';
import { address, bytesN, TIMEOUT, run } from '../formats/arbitraries';
import { addressWord, declaring, PARTIES, ZKPASSPORT } from './setup-fixtures';

const ZERO_WORD: Hex = `0x${'00'.repeat(32)}`;
const WORD = /^0x[0-9a-fA-F]{64}$/;

/** The zkPassport method's acceptance rule on its eight words, written from the contract and apart from src/, with a nonzero word 0. */
function accepts(words: readonly unknown[]): words is readonly Hex[] {
  if (words.length !== 8 || !words.every((word): word is Hex => typeof word === 'string' && WORD.test(word))) return false;

  const value = (digits: string): bigint => BigInt(`0x0${digits}`);

  return (
    words.every((word, index) => index === 6 || value(word.slice(2)) !== 0n) &&
    value((words[0] as Hex).slice(14)) === 0n &&
    words.slice(1).every((word) => value(word.slice(2, 26)) === 0n)
  );
}

const part = fc.integer({ min: 0, max: 0xffff }).map((n) => n.toString(16).padStart(4, '0'));
const versionWord = fc.tuple(part, part, part).map(([major, minor, patch]): Hex => `0x${major}${minor}${patch}${'0'.repeat(52)}`);
const roleWord = address.map((value) => addressWord(value as Hex));

/** A byte position and a nonzero byte, to dirty a word with. */
const dirt = fc.tuple(fc.nat(31), fc.integer({ min: 1, max: 255 }));

const dirtied = (word: Hex, [at, byte]: [number, number]): Hex =>
  `0x${word.slice(2, 2 + at * 2)}${byte.toString(16).padStart(2, '0')}${word.slice(4 + at * 2)}`;

/** A word that may break the rule: zero, dirtied, random, of the wrong width, not hex, or the wrong case. */
const strayWord: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(ZERO_WORD),
  fc.tuple(roleWord, dirt).map(([word, at]) => dirtied(word, at)),
  fc.tuple(versionWord, dirt).map(([word, at]) => dirtied(word, at)),
  bytesN(32),
  bytesN(31),
  bytesN(33),
  fc.constant(`0x${'zz'.repeat(32)}`),
  roleWord.map((word) => `0x${word.slice(2).toUpperCase()}`),
);

/** Eight words the rule accepts, the guardian word sometimes zero. */
const accepted = fc
  .tuple(versionWord, fc.array(roleWord, { minLength: 7, maxLength: 7 }), fc.boolean())
  .map(([version, roles, zeroGuardian]): unknown[] => [version, ...roles.map((role, at) => (at === 5 && zeroGuardian ? ZERO_WORD : role))]);

/** The accepted words with up to three edits: a word replaced by a stray one, a word dropped, or one appended. */
const edited = fc
  .tuple(accepted, fc.array(fc.tuple(fc.constantFrom('replace', 'drop', 'append'), fc.nat(8), strayWord), { maxLength: 3 }))
  .map(([words, edits]) =>
    edits.reduce<unknown[]>((list, [edit, at, word]) => {
      if (edit === 'drop') return list.filter((_, index) => index !== at % Math.max(list.length, 1));

      if (edit === 'append') return [...list, word];

      return list.map((current, index) => (index === at % Math.max(list.length, 1) ? word : current));
    }, words),
  );

const wordLists = fc.oneof(accepted, edited, fc.array(fc.oneof(strayWord, roleWord, versionWord), { maxLength: 10 }));

describe('describeSetup names the zkPassport words exactly where the method accepts them', () => {
  it('namedKeys is present iff the rule accepts, then encodes word 0 back and checksums each low 20 bytes', () => {
    run(fc.property(wordLists, (words) => {
      const read = { answered: true, value: { ...PARTIES, trustedKeys: words } } as ReadResult<Parties>;
      const { draft, context } = declaring(ZKPASSPORT, read);
      const [entry] = describeSetup(draft, context).parties.methods;

      expect(entry?.parties).toStrictEqual(read);
      expect(entry !== undefined && 'namedKeys' in entry).toBe(accepts(words));

      if (!accepts(words)) return;

      const keys = entry?.namedKeys;

      expect(keys?.kind).toBe('method-zkpassport');

      if (keys?.kind !== 'method-zkpassport') return;

      expect(zkPassportVersionWord(keys.version)).toBe((words[0] as Hex).toLowerCase());
      expect([keys.rootVerifier, keys.subVerifier, keys.verifierHelper, keys.rootRegistry, keys.rootAdmin, keys.rootGuardian, keys.subVerifierAdmin]).toStrictEqual(
        words.slice(1).map((word) => getAddress(`0x${(word as Hex).slice(26)}`)),
      );
    }));
  }, TIMEOUT);
});
