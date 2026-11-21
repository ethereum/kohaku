import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { describeSetup, type Address, type Hex, type NamedTrustedKeys, type Parties, type ReadResult } from '../../src/index';
import {
  AADHAAR,
  addressWord,
  CONTEXT,
  declaring,
  DESCRIPTOR,
  DRAFT,
  ECDSA,
  LABELLED_CONTEXT,
  PARTIES,
  PASSKEY,
  THIRD_PARTY,
  VERSION_WORD,
  ZKPASSPORT,
  ZKPASSPORT_PARTIES,
  ZKPASSPORT_WORDS,
} from './setup-fixtures';

const ZERO_WORD: Hex = `0x${'00'.repeat(32)}`;
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** An issuer key hash with letters, so its case spelling shows. */
const ISSUER_KEY_HASH: Hex = `0x${'1f'.repeat(16)}${'a2'.repeat(16)}`;

/** The checksummed address in a word's low 20 bytes, computed apart from src/. */
const low20 = (word: Hex): Address => getAddress(`0x${word.slice(26)}`);

/** The same hex digits in upper case, the prefix kept. */
const upper = (word: Hex): Hex => `0x${word.slice(2).toUpperCase()}`;

/** An answered declaration holding the given words, the rest of the fixtures' parties kept. */
const answered = (trustedKeys: readonly Hex[]): ReadResult<Parties> => ({ answered: true, value: { ...PARTIES, trustedKeys } });

/** The accepted words with one replaced. */
const withWord = (index: number, value: Hex): Hex[] => ZKPASSPORT_WORDS.map((word, at) => (at === index ? value : word));

/** The described entry of a draft whose one credential names the method, its declaration as given. */
function entryFor(method: Address, trustedParties: ReadResult<Parties>) {
  const { draft, context } = declaring(method, trustedParties);
  const [entry] = describeSetup(draft, context).parties.methods;

  if (entry === undefined) throw new Error('no described entry');

  return entry;
}

/** The eight labels of the accepted words, each address the checksummed low 20 bytes of its word. */
const named = (words: readonly Hex[], version: string): NamedTrustedKeys => ({
  kind: 'method-zkpassport',
  version,
  rootVerifier: low20(words[1] as Hex),
  subVerifier: low20(words[2] as Hex),
  verifierHelper: low20(words[3] as Hex),
  rootRegistry: low20(words[4] as Hex),
  rootAdmin: low20(words[5] as Hex),
  rootGuardian: low20(words[6] as Hex),
  subVerifierAdmin: low20(words[7] as Hex),
});

describe('describeSetup: the zkPassport method\'s trusted keys by name', () => {
  it('names the eight words in order, version 0.21.1 and each address checksummed, beside the declaration as read', () => {
    const read = answered(ZKPASSPORT_WORDS);
    const entry = entryFor(ZKPASSPORT, read);

    expect(entry).toStrictEqual({ method: ZKPASSPORT, parties: read, namedKeys: named(ZKPASSPORT_WORDS, '0.21.1') });
    expect(entry.parties).toBe(read);
  });

  it('checksums every address, none left in its lower-case spelling', () => {
    const keys = entryFor(ZKPASSPORT, answered(ZKPASSPORT_WORDS)).namedKeys;
    const addresses = keys?.kind === 'method-zkpassport' ? Object.entries(keys).filter(([name]) => name !== 'kind' && name !== 'version') : [];

    expect(addresses).toHaveLength(7);

    for (const [, address] of addresses) {
      expect(address).toBe(getAddress(address));
      expect(address).not.toBe(address.toLowerCase());
    }
  });

  it('names a zero guardian word the zero address', () => {
    const words = withWord(6, ZERO_WORD);

    expect(entryFor(ZKPASSPORT, answered(words)).namedKeys).toStrictEqual({ ...named(words, '0.21.1'), rootGuardian: ZERO_ADDRESS });
  });

  it('gives upper-case words the same labels, the declaration kept as read', () => {
    const words = ZKPASSPORT_WORDS.map(upper);
    const entry = entryFor(ZKPASSPORT, answered(words));

    expect(entry.namedKeys).toStrictEqual(named(ZKPASSPORT_WORDS, '0.21.1'));
    expect(entry.parties).toStrictEqual(answered(words));
  });

  it('gives mixed-case words the same labels', () => {
    const mixed = ZKPASSPORT_WORDS.map((word): Hex => `0x${[...word.slice(2)].map((digit, at) => (at % 2 === 0 ? digit.toUpperCase() : digit)).join('')}`);

    expect(entryFor(ZKPASSPORT, answered(mixed)).namedKeys).toStrictEqual(named(ZKPASSPORT_WORDS, '0.21.1'));
  });

  it.each<[string, Hex[], string]>([
    ['word 0 nonzero only in its sixth byte', withWord(0, `0x${'00'.repeat(5)}01${'00'.repeat(26)}`), '0.0.1'],
    ['word 0 nonzero only in its first byte', withWord(0, `0x01${'00'.repeat(31)}`), '256.0.0'],
    ['word 0 at the largest parts', withWord(0, `0x${'ff'.repeat(6)}${'00'.repeat(26)}`), '65535.65535.65535'],
    ['an address word nonzero only in its last byte', withWord(1, `0x${'00'.repeat(31)}01`), '0.21.1'],
    ['an address word nonzero only in its thirteenth byte', withWord(7, `0x${'00'.repeat(12)}01${'00'.repeat(19)}`), '0.21.1'],
  ])('names the words where %s, at the edge of the method\'s rule', (_name, words, version) => {
    expect(entryFor(ZKPASSPORT, answered(words)).namedKeys).toStrictEqual(named(words, version));
  });

  it('matches the descriptor\'s zkPassport address in any case spelling', () => {
    const lettered = getAddress('0xabcdef0123456789abcdef0123456789abcd0e0e');
    const { draft, context } = declaring(lettered, answered(ZKPASSPORT_WORDS));
    const spelled = { ...context, descriptor: { ...DESCRIPTOR, methodZkpassport: lettered.toLowerCase() as Address } };

    expect(describeSetup(draft, spelled).parties.methods[0]?.namedKeys).toStrictEqual(named(ZKPASSPORT_WORDS, '0.21.1'));
  });
});

describe('describeSetup leaves namedKeys out where the zkPassport declaration is not one the method accepts', () => {
  const dirtyUpperByte = (index: number): Hex => `0x${'00'.repeat(11)}01${(ZKPASSPORT_WORDS[index] as Hex).slice(26)}`;

  it.each<[string, unknown]>([
    ['seven words', ZKPASSPORT_WORDS.slice(0, 7)],
    ['nine words', [...ZKPASSPORT_WORDS, addressWord(PARTIES.admin)]],
    ['no words', []],
    ['a zero word 0', withWord(0, ZERO_WORD)],
    ['word 0 nonzero in its seventh byte', withWord(0, `0x${VERSION_WORD.slice(2, 14)}01${'00'.repeat(25)}`)],
    ['word 0 nonzero in its last byte', withWord(0, `0x${VERSION_WORD.slice(2, 64)}01`)],
    ...[1, 2, 3, 4, 5, 6, 7].map((index): [string, Hex[]] => [`word ${index} with its lowest upper byte set`, withWord(index, dirtyUpperByte(index))]),
    ['word 1 with its first byte set', withWord(1, `0x01${(ZKPASSPORT_WORDS[1] as Hex).slice(4)}`)],
    ...[1, 2, 3, 4, 5, 7].map((index): [string, Hex[]] => [`a zero word ${index}`, withWord(index, ZERO_WORD)]),
    ['a 31-byte word 0', withWord(0, `0x${VERSION_WORD.slice(2, 64)}`)],
    ['a 31-byte word 1', withWord(1, `0x${(ZKPASSPORT_WORDS[1] as Hex).slice(4)}`)],
    ['a 33-byte word 7', withWord(7, `0x00${(ZKPASSPORT_WORDS[7] as Hex).slice(2)}`)],
    ['a non-hex word 3', withWord(3, `0x${'zz'.repeat(32)}`)],
    ['a word 2 without its prefix', withWord(2, (ZKPASSPORT_WORDS[2] as Hex).slice(2) as Hex)],
    ['a number for word 4', withWord(4, 4 as unknown as Hex)],
    ['trustedKeys that is not a list', 'nope'],
  ])('%s: no key, the declaration as read, no throw', (_name, trustedKeys) => {
    const read = { answered: true, value: { ...PARTIES, trustedKeys } } as ReadResult<Parties>;
    const entry = entryFor(ZKPASSPORT, read);

    expect(Object.keys(entry).sort()).toEqual(['method', 'parties']);
    expect(entry.parties).toStrictEqual(read);
  });

  it('an unanswered declaration: no key', () => {
    expect(entryFor(ZKPASSPORT, { answered: false })).toStrictEqual({ method: ZKPASSPORT, parties: { answered: false } });
  });

  it.each([
    ['the ECDSA method', ECDSA],
    ['the passkey method', PASSKEY],
    ['a third-party method', THIRD_PARTY],
    ['the Aadhaar method', AADHAAR],
  ])('the eight accepted words on %s: no key', (_name, method) => {
    const read = answered(ZKPASSPORT_WORDS);

    expect(entryFor(method, read)).toStrictEqual({ method, parties: read });
  });
});

describe('describeSetup: the Aadhaar method\'s issuer key hash by name', () => {
  it('names one nonzero word the issuer key hash', () => {
    const read = answered([ISSUER_KEY_HASH]);

    expect(entryFor(AADHAAR, read)).toStrictEqual({ method: AADHAAR, parties: read, namedKeys: { kind: 'method-aadhaar', issuerKeyHash: ISSUER_KEY_HASH } });
  });

  it('names an upper-case word in lower case, the declaration kept as read', () => {
    const read = answered([upper(ISSUER_KEY_HASH)]);
    const entry = entryFor(AADHAAR, read);

    expect(entry.namedKeys).toStrictEqual({ kind: 'method-aadhaar', issuerKeyHash: ISSUER_KEY_HASH });
    expect(entry.parties).toStrictEqual(read);
  });

  it.each<[string, Hex]>([
    ['its lowest bit alone', `0x${'00'.repeat(31)}01`],
    ['its top bit alone', `0x80${'00'.repeat(31)}`],
  ])('names a word with %s', (_name, word) => {
    expect(entryFor(AADHAAR, answered([word])).namedKeys).toStrictEqual({ kind: 'method-aadhaar', issuerKeyHash: word });
  });

  it.each<[string, unknown]>([
    ['a zero word', [ZERO_WORD]],
    ['two nonzero words', [ISSUER_KEY_HASH, `0x${'33'.repeat(32)}`]],
    ['a nonzero word and a zero word', [ISSUER_KEY_HASH, ZERO_WORD]],
    ['no words', []],
    ['a 31-byte word', [`0x${'1f'.repeat(31)}`]],
    ['a 33-byte word', [`0x${'1f'.repeat(33)}`]],
    ['a non-hex word', [`0x${'zz'.repeat(32)}`]],
  ])('%s: no key, the declaration as read, no throw', (_name, trustedKeys) => {
    const read = { answered: true, value: { ...PARTIES, trustedKeys } } as ReadResult<Parties>;
    const entry = entryFor(AADHAAR, read);

    expect(Object.keys(entry).sort()).toEqual(['method', 'parties']);
    expect(entry.parties).toStrictEqual(read);
  });

  it('an unanswered declaration: no key', () => {
    expect(entryFor(AADHAAR, { answered: false })).toStrictEqual({ method: AADHAAR, parties: { answered: false } });
  });

  it('one word on the zkPassport method: no key', () => {
    expect('namedKeys' in entryFor(ZKPASSPORT, answered([ISSUER_KEY_HASH]))).toBe(false);
  });
});

describe('describeSetup: naming the keys changes nothing else', () => {
  it('the fixtures\' description names no keys, its zkPassport declaration holding one word', () => {
    expect(describeSetup(DRAFT, CONTEXT).parties.methods.filter((entry) => 'namedKeys' in entry)).toEqual([]);
  });

  it('the labelled description is the fixtures\' one with the zkPassport words and their names added', () => {
    const labelled = describeSetup(DRAFT, LABELLED_CONTEXT);
    const plain = describeSetup(DRAFT, CONTEXT);
    const zkPassport = labelled.parties.methods.find((entry) => entry.method === ZKPASSPORT);
    const others = labelled.parties.methods.filter((entry) => entry.method !== ZKPASSPORT);

    expect(zkPassport?.namedKeys).toStrictEqual(named(ZKPASSPORT_WORDS, '0.21.1'));
    expect(zkPassport?.parties).toStrictEqual({ answered: true, value: { ...ZKPASSPORT_PARTIES, trustedKeys: ZKPASSPORT_WORDS } });
    expect(others).toStrictEqual(plain.parties.methods.filter((entry) => entry.method !== ZKPASSPORT));
    expect({ ...labelled, parties: { ...labelled.parties, methods: others } }).toStrictEqual({
      ...plain,
      parties: { ...plain.parties, methods: others },
    });
  });
});
