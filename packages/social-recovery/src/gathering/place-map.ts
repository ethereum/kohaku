import { credentialHash } from '../formats/commitments';
import { assertBool, assertObject, normalizeAddress } from '../formats/guards';
import { STANDINGS } from '../interfaces';
import type { Address, Configuration, Credential, GatheringPlace, Hex } from '../interfaces';
import { defaultSalt } from '../salts';
import type { PlaceStanding, SetupBody } from '../types';
import { placeCount } from './edge';

/** Refuses a standing reading that is not one of the place's three facts. */
function checkedStanding(reading: PlaceStanding | undefined, place: number): PlaceStanding {
  assertObject(reading, `standings[${place}]`);

  if (!STANDINGS.includes(reading.standing)) {
    throw new TypeError(`standings[${place}].standing must be one of ${STANDINGS.join(', ')}`);
  }

  assertBool(reading.stoppable, `standings[${place}].stoppable`);
  assertBool(reading.credentialHoldsCode, `standings[${place}].credentialHoldsCode`);

  return reading;
}

/**
 * The whole place map, one place per credential in body order, numbered by the flat index across the clauses.
 * Throws where the configuration's clauses, credentials or credential hashes differ from the body's, or the standings miss a place.
 * A credential with no salt takes the default salt of `account` at its place.
 */
export function placeMap(
  body: SetupBody,
  configuration: Configuration,
  standings: readonly PlaceStanding[],
  account: Address,
): GatheringPlace[] {
  assertObject(body, 'body');
  assertObject(configuration, 'configuration');

  const total = placeCount(body);

  if (!Array.isArray(standings) || standings.length !== total) {
    throw new RangeError(`standings must hold one reading per place, ${total}`);
  }

  if (!Array.isArray(configuration.clauses) || configuration.clauses.length !== body.clauses.length) {
    throw new RangeError('configuration clauses do not match the body');
  }

  let place = -1;

  return body.clauses.flatMap((clause, index) => {
    const credentials = configuration.clauses[index]?.credentials;

    if (!Array.isArray(credentials) || credentials.length !== clause.credentials.length) {
      throw new RangeError(`configuration clause ${index} does not match the body`);
    }

    return clause.credentials.map((committed, position) => {
      const credential = credentials[position] as Credential;

      place += 1;

      const salt: Hex = credential.salt ?? defaultSalt(account, place);

      if (credentialHash(credential.method, credential.config, salt).toLowerCase() !== committed.toLowerCase()) {
        throw new RangeError(`configuration credential at place ${place} does not match the body's credential hash`);
      }

      const { standing, stoppable, credentialHoldsCode } = checkedStanding(standings[place], place);
      const entry: GatheringPlace = {
        place,
        method: normalizeAddress(credential.method, `place ${place} method`),
        config: credential.config,
        salt,
        standing,
        stoppable,
        credentialHoldsCode,
      };

      return credential.label === undefined ? entry : { ...entry, label: credential.label };
    });
  });
}
