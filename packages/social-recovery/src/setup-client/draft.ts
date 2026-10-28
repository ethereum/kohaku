import { assertBytes, lowerHex } from '../formats/guards';
import type { Clause, Configuration, Credential, Hex, SetupDraft } from '../interfaces';
import type { PlacedCredential } from '../types/validation';
import { placedCredentials } from '../validation/setup-draft';

/** Refuses a hole in the draft's clause list or in any clause's credential list. */
function assertNoHoles(draft: SetupDraft): void {
  for (let index = 0; index < draft.clauses.length; index += 1) {
    if (!(index in draft.clauses)) throw new TypeError(`draft.clauses[${index}] is missing`);

    const { credentials } = draft.clauses[index] as Clause;

    for (let position = 0; position < credentials.length; position += 1) {
      if (!(position in credentials)) throw new TypeError(`draft.clauses[${index}].credentials[${position}] is missing`);
    }
  }
}

/**
 * The draft's credentials by place, refusing a malformed draft, a hole in its lists and public metadata that is not hex.
 * A threshold or wait past its field's width is accepted here, since judging it is a validation finding.
 */
export function checkedDraft(draft: SetupDraft): readonly PlacedCredential[] {
  const credentials = placedCredentials(draft);

  assertNoHoles(draft);
  assertBytes(draft.privacy.publicMetadata, 'draft.privacy.publicMetadata');

  return credentials;
}

/** The configuration a checked draft commits to, every method checksummed and every config and salt lower-cased. */
export function draftConfiguration(draft: SetupDraft, credentials: readonly PlacedCredential[]): Configuration {
  const clauses = draft.clauses.map(
    (clause, index): Clause => ({
      threshold: clause.threshold,
      credentials: credentials
        .filter((credential) => credential.clause === index)
        .map(
          ({ method, config, salt, label }): Credential => ({
            method,
            config,
            ...(salt === undefined ? {} : { salt: lowerHex(salt) }),
            ...(label === undefined ? {} : { label }),
          }),
        ),
    }),
  );

  return { clauses, wait: draft.wait, ignoresPause: draft.ignoresPause };
}

/** The draft's public metadata, lower-cased, for a draft already checked. */
export const publicMetadataOf = (draft: SetupDraft): Hex => lowerHex(draft.privacy.publicMetadata);

/** The checked draft as a new record, every method checksummed and every hex lower-cased; the caller's draft is left as given. */
export const checkedDraftRecord = (draft: SetupDraft, credentials: readonly PlacedCredential[]): SetupDraft => ({
  ...draftConfiguration(draft, credentials),
  privacy: { publicMetadata: publicMetadataOf(draft), backup: draft.privacy.backup },
});
