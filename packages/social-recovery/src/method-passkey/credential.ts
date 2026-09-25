import * as Cbor from 'ox/Cbor';
import * as CoseKey from 'ox/CoseKey';
import * as P256 from 'ox/P256';
import {
  METHOD_PASSKEY_AAGUID_LENGTH,
  METHOD_PASSKEY_AUTHENTICATOR_DATA_FLAGS_OFFSET,
  METHOD_PASSKEY_AUTHENTICATOR_DATA_MIN_LENGTH,
  METHOD_PASSKEY_COSE_ALGORITHM_ES256,
  METHOD_PASSKEY_COSE_CURVE_P256,
  METHOD_PASSKEY_COSE_KEY_TYPE_EC2,
  METHOD_PASSKEY_COSE_LABEL_ALGORITHM,
  METHOD_PASSKEY_COSE_LABEL_CURVE,
  METHOD_PASSKEY_COSE_LABEL_KEY_TYPE,
  METHOD_PASSKEY_COSE_LABEL_X,
  METHOD_PASSKEY_COSE_LABEL_Y,
  METHOD_PASSKEY_CREDENTIAL_ID_LENGTH_SIZE,
  METHOD_PASSKEY_FLAG_ATTESTED_CREDENTIAL,
  METHOD_PASSKEY_P256_COORDINATE_LENGTH,
  METHOD_PASSKEY_RP_ID_HASH_LENGTH,
} from '../constants';
import type { Hex } from '../interfaces';
import type { EnrolledKey } from '../types';
import { bufferBytes, hexOf, memberOf } from './bytes';

const decodeCbor = (bytes: Uint8Array): unknown => {
  try {
    return Cbor.decode(bytes);
  } catch {
    return undefined;
  }
};

const isCoordinate = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array && value.length === METHOD_PASSKEY_P256_COORDINATE_LENGTH;

/** The COSE key's bytes where its header names an ES256 key on P-256 with two 32-byte coordinates. */
const es256Key = (coseBytes: Uint8Array): Hex | undefined => {
  const key = decodeCbor(coseBytes);

  if (
    memberOf(key, METHOD_PASSKEY_COSE_LABEL_KEY_TYPE) !== METHOD_PASSKEY_COSE_KEY_TYPE_EC2 ||
    memberOf(key, METHOD_PASSKEY_COSE_LABEL_ALGORITHM) !== METHOD_PASSKEY_COSE_ALGORITHM_ES256 ||
    memberOf(key, METHOD_PASSKEY_COSE_LABEL_CURVE) !== METHOD_PASSKEY_COSE_CURVE_P256 ||
    !isCoordinate(memberOf(key, METHOD_PASSKEY_COSE_LABEL_X)) ||
    !isCoordinate(memberOf(key, METHOD_PASSKEY_COSE_LABEL_Y))
  ) {
    return undefined;
  }

  return hexOf(coseBytes);
};

/** The point where it lies on P-256, or undefined. */
const onCurve = (x: bigint, y: bigint): { x: bigint; y: bigint } | undefined => {
  try {
    P256.noble.ProjectivePoint.fromAffine({ x, y }).assertValidity();

    return { x, y };
  } catch {
    return undefined;
  }
};

/**
 * The ES256 key on P-256 a `navigator.credentials.create` result holds, or undefined; the caller compares the rp hash.
 * Read from the attestation object, since the Android WebView exposes no `getPublicKey()`.
 */
export const enrolledKey = (credential: unknown): EnrolledKey | undefined => {
  const attestationObject = bufferBytes(memberOf(memberOf(credential, 'response'), 'attestationObject'));

  if (attestationObject === undefined) return undefined;

  const authData = memberOf(decodeCbor(attestationObject), 'authData');
  const keyOffset = METHOD_PASSKEY_AUTHENTICATOR_DATA_MIN_LENGTH + METHOD_PASSKEY_AAGUID_LENGTH + METHOD_PASSKEY_CREDENTIAL_ID_LENGTH_SIZE;

  if (!(authData instanceof Uint8Array) || authData.length <= keyOffset) return undefined;

  if (((authData[METHOD_PASSKEY_AUTHENTICATOR_DATA_FLAGS_OFFSET] ?? 0) & METHOD_PASSKEY_FLAG_ATTESTED_CREDENTIAL) === 0) return undefined;

  const idLength = ((authData[keyOffset - 2] ?? 0) << 8) | (authData[keyOffset - 1] ?? 0);
  const coseKey = es256Key(authData.subarray(keyOffset + idLength));

  if (coseKey === undefined) return undefined;

  const { x, y } = CoseKey.toPublicKey(coseKey);
  const point = onCurve(x, y);

  if (point === undefined) return undefined;

  return { ...point, rpIdHash: hexOf(authData.subarray(0, METHOD_PASSKEY_RP_ID_HASH_LENGTH)) };
};
