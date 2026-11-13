import { getAddress, size, slice } from 'viem';
import {
  DESCRIPTION_ISSUER_KEY_NAMES,
  DESCRIPTION_ZKPASSPORT_KEY_NAMES,
  DESCRIPTION_ZKPASSPORT_OPTIONAL_KEY,
  FORMATS_ADDRESS_BYTES,
  FORMATS_HEX_BYTES32_PATTERN,
  METHOD_ZKPASSPORT_VERSION_KEY,
  METHOD_ZKPASSPORT_VERSION_PART_BYTES,
  METHOD_ZKPASSPORT_VERSION_PARTS,
} from '../constants';
import { isRecord, lowerHex } from '../formats/guards';
import type { Address, Hex, NamedTrustedKeys, Parties, ReadResult } from '../interfaces';
import type { IdentityMethods } from '../types/description';
import { zkPassportVersionOf } from './zkpassport-version';

const VERSION_BYTES = METHOD_ZKPASSPORT_VERSION_PARTS * METHOD_ZKPASSPORT_VERSION_PART_BYTES;

const isWord = (value: unknown): value is Hex => typeof value === 'string' && FORMATS_HEX_BYTES32_PATTERN.test(value);

const isZero = (bytes: Hex): boolean => BigInt(bytes) === 0n;

/** The bytes of a word above its low 20. */
const upperOf = (word: Hex): Hex => slice(word, 0, size(word) - FORMATS_ADDRESS_BYTES);

/** The checksummed address in a word's low 20 bytes. */
function addressOf(word: Hex): Address {
  const low = slice(word, size(word) - FORMATS_ADDRESS_BYTES);

  return getAddress(low);
}

/** The declaration's trusted keys as lower-case 32-byte words; undefined where the read was not answered or an entry is not one. */
function declaredWords(parties: ReadResult<Parties>): Hex[] | undefined {
  if (!isRecord(parties) || parties.answered !== true || !isRecord(parties.value)) return undefined;

  const { trustedKeys } = parties.value;

  if (!Array.isArray(trustedKeys)) return undefined;

  const entries: unknown[] = Array.from(trustedKeys);

  return entries.every(isWord) ? entries.map(lowerHex) : undefined;
}

/** Whether the words pass the zkPassport method's own acceptance rule: one per name, a canonical version, then address words of which only the root guardian may be zero. */
function zkPassportAccepts(words: readonly Hex[]): boolean {
  if (words.length !== DESCRIPTION_ZKPASSPORT_KEY_NAMES.length) return false;

  return words.every((word, index) => {
    if (index === METHOD_ZKPASSPORT_VERSION_KEY) return !isZero(word) && isZero(slice(word, VERSION_BYTES));

    return (index === DESCRIPTION_ZKPASSPORT_OPTIONAL_KEY || !isZero(word)) && isZero(upperOf(word));
  });
}

/** The zkPassport names over accepted words: the version decoded, every other word its address. */
function zkPassportKeys(words: readonly Hex[]): NamedTrustedKeys {
  const entries = DESCRIPTION_ZKPASSPORT_KEY_NAMES.map((name, index): [string, string] => {
    const word = words[index] as Hex;

    return [name, index === METHOD_ZKPASSPORT_VERSION_KEY ? zkPassportVersionOf(word) : addressOf(word)];
  });

  return { kind: 'method-zkpassport', ...Object.fromEntries(entries) } as NamedTrustedKeys;
}

/** Whether the words pass the Aadhaar method's acceptance rule: exactly one, nonzero. */
const aadhaarAccepts = (words: readonly Hex[]): words is [Hex] =>
  words.length === DESCRIPTION_ISSUER_KEY_NAMES.length && words.every((word) => !isZero(word));

/**
 * The trusted keys by name of the deployment's zkPassport or Aadhaar method, where its declaration was read and its words pass
 * that method's own acceptance rule; undefined for any other method or declaration. It never throws.
 */
export function namedKeysOf(method: Address, parties: ReadResult<Parties>, identity: IdentityMethods): NamedTrustedKeys | undefined {
  const words = declaredWords(parties);

  if (words === undefined) return undefined;

  if (method === identity.zkPassport && zkPassportAccepts(words)) return zkPassportKeys(words);

  if (method === identity.aadhaar && aadhaarAccepts(words)) return { kind: 'method-aadhaar', issuerKeyHash: words[0] };

  return undefined;
}
