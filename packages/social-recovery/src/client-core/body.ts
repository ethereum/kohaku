import { FORMATS_THRESHOLD_BITS, FORMATS_WAIT_BITS } from '../constants';
import { credentialHash, encodeSetupBody, setupCommitment } from '../formats';
import { assertArray, assertBool, assertBytes32, assertObject, assertUintNumber, normalizeAddress } from '../formats/guards';
import type { Address, Clause, Configuration, Credential, Hex } from '../interfaces';
import { defaultSalt } from '../salts';
import type { BodyClause, SetupBody } from '../types';

/** Refuses a missing or malformed member of the configuration, a hole in a clause or credential list among them. */
function assertConfigurationShape(configuration: Configuration): void {
  assertObject(configuration, 'configuration');
  assertUintNumber(configuration.wait, FORMATS_WAIT_BITS, 'configuration.wait');
  assertBool(configuration.ignoresPause, 'configuration.ignoresPause');
  assertArray(configuration.clauses, 'configuration.clauses');

  for (let index = 0; index < configuration.clauses.length; index += 1) {
    const clause = configuration.clauses[index];

    assertObject(clause, `configuration.clauses[${index}]`);
    assertUintNumber(clause.threshold, FORMATS_THRESHOLD_BITS, `configuration.clauses[${index}].threshold`);
    assertArray(clause.credentials, `configuration.clauses[${index}].credentials`);

    for (let position = 0; position < clause.credentials.length; position += 1) {
      const credential = clause.credentials[position];
      const name = `configuration.clauses[${index}].credentials[${position}]`;

      assertObject(credential, name);

      if (credential.salt !== undefined) assertBytes32(credential.salt, `${name}.salt`);
    }
  }
}

/**
 * The setup body a configuration or a draft commits to: each credential hashed with its supplied salt, or with the
 * default salt of its place, the places numbered across all clauses in order from 0; labels are not covered.
 */
export function configurationBody(configuration: Configuration, account: Address): SetupBody {
  assertConfigurationShape(configuration);

  const accountAddress = normalizeAddress(account, 'account');
  const clauses: BodyClause[] = [];
  let place = 0;

  for (let index = 0; index < configuration.clauses.length; index += 1) {
    const clause = configuration.clauses[index] as Clause;
    const credentials: Hex[] = [];

    for (let position = 0; position < clause.credentials.length; position += 1) {
      const { method, config, salt } = clause.credentials[position] as Credential;
      const credentialSalt = salt === undefined ? defaultSalt(accountAddress, place) : salt;

      credentials.push(credentialHash(method, config, credentialSalt));
      place += 1;
    }

    clauses.push({ threshold: clause.threshold, credentials });
  }

  return { wait: configuration.wait, ignoresPause: configuration.ignoresPause, clauses };
}

/** The setup commitment a configuration or a draft recomputes to for the account, the action and the setup nonce. */
export function configurationCommitment(configuration: Configuration, account: Address, action: Address, nonce: bigint): Hex {
  const body = configurationBody(configuration, account);
  const encoded = encodeSetupBody(body);

  return setupCommitment(account, action, nonce, encoded);
}
