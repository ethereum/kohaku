import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { FORMATS_SETUP_BODY_ABI, FORMATS_THRESHOLD_BITS, FORMATS_WAIT_BITS } from '../constants';
import type { Hex } from '../interfaces';
import { assertArray, assertBool, assertBytes32, assertObject, assertUintNumber } from './guards';
import { decodeStrictly } from './strict';
import type { BodyClause, SetupBody } from '../types';

/** Refuses a missing body and a body member outside its width. */
function assertSetupBody(body: SetupBody): void {
  assertObject(body, 'body');
  assertUintNumber(body.wait, FORMATS_WAIT_BITS, 'wait');
  assertBool(body.ignoresPause, 'ignoresPause');

  assertArray(body.clauses, 'clauses');

  body.clauses.forEach((clause: BodyClause, index) => {
    assertUintNumber(clause.threshold, FORMATS_THRESHOLD_BITS, `clauses[${index}].threshold`);

    assertArray(clause.credentials, `clauses[${index}].credentials`);

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
  return decodeStrictly(encoded, 'setupBody', '(uint48, bool, (uint8, bytes32[])[])', {
    decode: (bytes) => decodeAbiParameters(FORMATS_SETUP_BODY_ABI, bytes),
    build: ([wait, ignoresPause, clauses]) => ({
      wait,
      ignoresPause,
      clauses: clauses.map((clause) => ({ threshold: clause.threshold, credentials: [...clause.credentials] })),
    }),
    encode: encodeSetupBody,
  });
}
