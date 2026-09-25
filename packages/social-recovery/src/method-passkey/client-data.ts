import {
  METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_KEY,
  METHOD_PASSKEY_CLIENT_DATA_CLOSERS,
  METHOD_PASSKEY_CLIENT_DATA_OPENERS,
  METHOD_PASSKEY_CLIENT_DATA_TOKEN,
  METHOD_PASSKEY_CLIENT_DATA_TYPE_KEY,
} from '../constants';
import type { ClientDataMembers } from '../types';

const isObjectText = (text: string): boolean => {
  if (!text.startsWith('{') || !text.endsWith('}')) return false;

  try {
    const parsed: unknown = JSON.parse(text);

    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
};

/** Where each top-level member name starts, keyed by the decoded name so an escaped spelling counts as the same. */
const topLevelNames = (text: string): Map<string, number[]> => {
  const names = new Map<string, number[]>();
  let depth = 0;
  let expectName = false;

  for (const match of text.matchAll(METHOD_PASSKEY_CLIENT_DATA_TOKEN)) {
    const token = match[0];

    if (METHOD_PASSKEY_CLIENT_DATA_OPENERS.has(token)) {
      depth += 1;
      expectName = depth === 1;
    } else if (METHOD_PASSKEY_CLIENT_DATA_CLOSERS.has(token)) {
      depth -= 1;
    } else if (token === ',') {
      expectName = depth === 1;
    } else {
      if (depth === 1 && expectName) {
        const name = JSON.parse(token) as string;

        names.set(name, [...(names.get(name) ?? []), match.index]);
      }

      expectName = false;
    }
  }

  return names;
};

/**
 * The top-level `type` and `challenge` positions, or undefined unless the text is one JSON object from its first
 * byte to its last naming each at most once; duplicates are found on the original text, since `JSON.parse` keeps the last.
 */
export const clientDataMembers = (text: string): ClientDataMembers | undefined => {
  if (!isObjectText(text)) return undefined;

  const names = topLevelNames(text);
  const types = names.get(METHOD_PASSKEY_CLIENT_DATA_TYPE_KEY) ?? [];
  const challenges = names.get(METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_KEY) ?? [];

  if (types.length > 1 || challenges.length > 1) return undefined;

  return { typeIndex: types[0], challengeIndex: challenges[0] };
};
