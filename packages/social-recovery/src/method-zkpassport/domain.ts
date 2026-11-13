import { hexToBigInt, sha256, slice, stringToHex } from 'viem';
import { METHOD_ZKPASSPORT_SCOPE_HASH_BYTES } from '../constants';
import {
  METHOD_ZKPASSPORT_DOMAIN_FRAGMENT_PATTERN,
  METHOD_ZKPASSPORT_DOMAIN_PATH_PATTERN,
  METHOD_ZKPASSPORT_DOMAIN_PORT_PATTERN,
  METHOD_ZKPASSPORT_DOMAIN_QUERY_PATTERN,
  METHOD_ZKPASSPORT_DOMAIN_SCHEME_PATTERN,
} from '../constants/method-zkpassport-parse';

/** The domain as rewritten by the rule `@zkpassport/sdk` 0.17.1's constructor applies, the domain its requests and proofs then carry. */
export const stackDomain = (domain: string): string =>
  domain
    .trim()
    .replace(METHOD_ZKPASSPORT_DOMAIN_SCHEME_PATTERN, '')
    .replace(METHOD_ZKPASSPORT_DOMAIN_PATH_PATTERN, '')
    .replace(METHOD_ZKPASSPORT_DOMAIN_PORT_PATTERN, '')
    .replace(METHOD_ZKPASSPORT_DOMAIN_QUERY_PATTERN, '')
    .replace(METHOD_ZKPASSPORT_DOMAIN_FRAGMENT_PATTERN, '')
    .toLowerCase();

/** Whether the rule `@zkpassport/sdk` 0.17.1's constructor applies leaves the domain unchanged. */
export const isCanonicalDomain = (domain: string): boolean => stackDomain(domain) === domain;

/** The scope hash a proof carries for a text: zero for the empty text, else the leading bytes of its UTF-8 `sha256`. */
export const serviceScopeHash = (text: string): bigint => {
  if (text === '') return 0n;

  const digest = sha256(stringToHex(text));

  return hexToBigInt(slice(digest, 0, METHOD_ZKPASSPORT_SCOPE_HASH_BYTES));
};

/** Whether a request can be made for a config's domain and scope: both non-empty and the domain one the stack keeps as given. */
export const servable = (domain: string, scope: string): boolean =>
  domain.length > 0 && scope.length > 0 && isCanonicalDomain(domain);
