import { FORMATS_SAFE_INTEGER_BITS } from '../constants';
import { assertArray, assertBool, assertBytes, assertBytes32, assertObject, assertUintNumber, normalizeAddress } from '../formats/guards';
import { BACKUP_CHOICES, type Clause, type Credential, type Hex, type SetupDraft } from '../interfaces';
import type { PlacedCredential } from '../types/validation';

/** Refuses a credential whose members are not the shapes the record declares, and returns it with its place. */
function placed(value: unknown, clause: number, place: number, name: string): PlacedCredential {
  assertObject(value, name);

  const credential = value as { readonly [Member in keyof Credential]?: unknown };
  const method = normalizeAddress(credential.method, `${name}.method`);

  assertBytes(credential.config, `${name}.config`);

  if (credential.salt !== undefined) assertBytes32(credential.salt, `${name}.salt`);

  if (credential.label !== undefined && typeof credential.label !== 'string') {
    throw new TypeError(`${name}.label must be a string`);
  }

  return {
    place,
    clause,
    method,
    config: (credential.config as Hex).toLowerCase() as Hex,
    ...(credential.salt === undefined ? {} : { salt: credential.salt as Hex }),
    ...(credential.label === undefined ? {} : { label: credential.label as string }),
  };
}

/**
 * Refuses a draft whose members are not the shapes the record declares, and returns its credentials by place.
 * A threshold or wait past its field's width is accepted here, since judging it is a finding.
 */
export function placedCredentials(draft: SetupDraft): PlacedCredential[] {
  assertObject(draft, 'draft');
  assertUintNumber(draft.wait, FORMATS_SAFE_INTEGER_BITS, 'draft.wait');
  assertBool(draft.ignoresPause, 'draft.ignoresPause');
  assertObject(draft.privacy, 'draft.privacy');

  if (!BACKUP_CHOICES.includes(draft.privacy.backup)) throw new TypeError('draft.privacy.backup is not a backup choice');

  assertArray(draft.clauses, 'draft.clauses');

  const credentials: PlacedCredential[] = [];

  draft.clauses.forEach((clause: Clause, index) => {
    assertObject(clause, `draft.clauses[${index}]`);
    assertUintNumber(clause.threshold, FORMATS_SAFE_INTEGER_BITS, `draft.clauses[${index}].threshold`);
    assertArray(clause.credentials, `draft.clauses[${index}].credentials`);

    clause.credentials.forEach((credential, position) => {
      credentials.push(placed(credential, index, credentials.length, `draft.clauses[${index}].credentials[${position}]`));
    });
  });

  return credentials;
}
