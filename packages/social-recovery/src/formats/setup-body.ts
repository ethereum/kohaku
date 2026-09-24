import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { FORMATS_SETUP_BODY_ABI, FORMATS_THRESHOLD_BITS, FORMATS_WAIT_BITS } from '../constants';
import type { Hex } from '../interfaces';
import { assertBool, assertBytes, assertBytes32, assertUintNumber } from './guards';
import type { BodyClause, SetupBody } from '../types';

/** Refuses a body member outside its width. */
function assertSetupBody(body: SetupBody): void {
  assertUintNumber(body.wait, FORMATS_WAIT_BITS, 'wait');
  assertBool(body.ignoresPause, 'ignoresPause');

  if (!Array.isArray(body.clauses)) {
    throw new TypeError('clauses must be an array');
  }

  body.clauses.forEach((clause: BodyClause, index) => {
    assertUintNumber(clause.threshold, FORMATS_THRESHOLD_BITS, `clauses[${index}].threshold`);

    if (!Array.isArray(clause.credentials)) {
      throw new TypeError(`clauses[${index}].credentials must be an array`);
    }

    clause.credentials.forEach((credential, position) => {
      assertBytes32(credential, `clauses[${index}].credentials[${position}]`);
    });
  });
}

/** Encodes a setup body, throwing on a member outside its width; an empty clause list is accepted. */
export function encodeSetupBody(body: SetupBody): Hex {
  assertSetupBody(body);

  return encodeAbiParameters(FORMATS_SETUP_BODY_ABI, [
    body.wait,
    body.ignoresPause,
    body.clauses.map((clause) => ({ threshold: clause.threshold, credentials: [...clause.credentials] })),
  ]);
}

/** Decodes setup body bytes, refusing any its encoder would not reproduce, so a decoded body re-encodes to its input. */
export function decodeSetupBody(encoded: Hex): SetupBody {
  assertBytes(encoded, 'setupBody');

  let decoded: SetupBody;

  try {
    const [wait, ignoresPause, clauses] = decodeAbiParameters(FORMATS_SETUP_BODY_ABI, encoded);

    decoded = {
      wait,
      ignoresPause,
      clauses: clauses.map((clause) => ({ threshold: clause.threshold, credentials: [...clause.credentials] })),
    };
  } catch (cause) {
    throw new RangeError('setupBody does not decode as (uint48, bool, (uint8, bytes32[])[])', { cause });
  }

  let reencoded: Hex;

  try {
    reencoded = encodeSetupBody(decoded);
  } catch (cause) {
    throw new RangeError('setupBody carries a member outside its width', { cause });
  }

  if (reencoded !== encoded.toLowerCase()) {
    throw new RangeError('setupBody is not in the canonical encoding its members re-encode to');
  }

  return decoded;
}
