import * as PublicKey from 'ox/PublicKey';
import * as WebAuthnP256 from 'ox/WebAuthnP256';
import { hexToBytes } from 'viem';
import {
  METHOD_PASSKEY_AUTHENTICATOR_DATA_FLAGS_OFFSET,
  METHOD_PASSKEY_AUTHENTICATOR_DATA_MIN_LENGTH,
  METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_CLOSE,
  METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_INDEX,
  METHOD_PASSKEY_CLIENT_DATA_PREFIX,
  METHOD_PASSKEY_CLIENT_DATA_TYPE_INDEX,
  METHOD_PASSKEY_FLAG_USER_PRESENT,
  METHOD_PASSKEY_FLAG_USER_VERIFIED,
  METHOD_PASSKEY_P256_HALF_ORDER,
  METHOD_PASSKEY_P256_ORDER,
  METHOD_PASSKEY_RP_ID_HASH_LENGTH,
  METHOD_PASSKEY_UNCOMPRESSED_POINT_PREFIX,
} from '../constants';
import { lowerHex } from '../formats/guards';
import type { Hex } from '../interfaces';
import type { AssertionCheck, PasskeyConfig, PasskeyProof } from '../types/method-passkey';
import { challengeText, hexOf } from './bytes';

/** Ox's check of the signature over `sha256(authenticatorData || sha256(clientDataJSON))`, false where ox throws. */
const signatureVerifies = (config: PasskeyConfig, digest: Hex, proof: PasskeyProof): boolean => {
  try {
    return WebAuthnP256.verify({
      challenge: lowerHex(digest),
      publicKey: PublicKey.from({ prefix: METHOD_PASSKEY_UNCOMPRESSED_POINT_PREFIX, x: config.x, y: config.y }),
      signature: { r: proof.r, s: proof.s },
      metadata: {
        authenticatorData: proof.authenticatorData,
        clientDataJSON: proof.clientDataJSON,
        challengeIndex: METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_INDEX,
        typeIndex: METHOD_PASSKEY_CLIENT_DATA_TYPE_INDEX,
        userVerificationRequired: true,
      },
    });
  } catch {
    return false;
  }
};

/**
 * The first check one assertion fails against the config and the digest, or `ok`.
 * The client data must begin with exactly the type, then the digest's unpadded base64url challenge and its closing quote.
 */
export const checkAssertion = (config: PasskeyConfig, digest: Hex, proof: PasskeyProof): AssertionCheck => {
  const authenticatorData = hexToBytes(proof.authenticatorData);

  if (authenticatorData.length < METHOD_PASSKEY_AUTHENTICATOR_DATA_MIN_LENGTH) return 'authenticator-data-short';

  if (hexOf(authenticatorData.subarray(0, METHOD_PASSKEY_RP_ID_HASH_LENGTH)) !== lowerHex(config.rpIdHash)) {
    return 'rp-id-hash-mismatch';
  }

  const flags = authenticatorData[METHOD_PASSKEY_AUTHENTICATOR_DATA_FLAGS_OFFSET] ?? 0;

  if ((flags & METHOD_PASSKEY_FLAG_USER_PRESENT) === 0) return 'user-not-present';

  if ((flags & METHOD_PASSKEY_FLAG_USER_VERIFIED) === 0) return 'user-not-verified';

  const expected = `${METHOD_PASSKEY_CLIENT_DATA_PREFIX}${challengeText(digest)}${METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_CLOSE}`;

  if (!proof.clientDataJSON.startsWith(expected)) return 'client-data-prefix';

  if (proof.r <= 0n || proof.r >= METHOD_PASSKEY_P256_ORDER || proof.s <= 0n || proof.s > METHOD_PASSKEY_P256_HALF_ORDER) {
    return 'signature-out-of-range';
  }

  return signatureVerifies(config, digest, proof) ? 'ok' : 'signature-invalid';
};
