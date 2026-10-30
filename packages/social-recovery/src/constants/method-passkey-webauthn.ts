/** The length of the relying-party hash that opens the authenticator data. */
export const METHOD_PASSKEY_RP_ID_HASH_LENGTH = 32;

/** The position of the flags byte, right after the relying-party hash. */
export const METHOD_PASSKEY_AUTHENTICATOR_DATA_FLAGS_OFFSET = 32;

/** The shortest authenticator data: the relying-party hash, the flags byte and the 4-byte counter. */
export const METHOD_PASSKEY_AUTHENTICATOR_DATA_MIN_LENGTH = 37;

/** The user-present bit of the authenticator data's flags byte (WebAuthn L2 §6.1). */
export const METHOD_PASSKEY_FLAG_USER_PRESENT = 0x01;

/** The user-verified bit of the authenticator data's flags byte (WebAuthn L2 §6.1). */
export const METHOD_PASSKEY_FLAG_USER_VERIFIED = 0x04;

/** The attested-credential-data bit, set on the authenticator data a creation returns (WebAuthn L2 §6.1). */
export const METHOD_PASSKEY_FLAG_ATTESTED_CREDENTIAL = 0x40;

/** The length of the AAGUID that follows the counter in attested credential data (WebAuthn L2 §6.5.1). */
export const METHOD_PASSKEY_AAGUID_LENGTH = 16;

/** The size of the big-endian credential id length that follows the AAGUID (WebAuthn L2 §6.5.1). */
export const METHOD_PASSKEY_CREDENTIAL_ID_LENGTH_SIZE = 2;

/** The COSE key type, algorithm and curve of an ES256 key on P-256 (RFC 9053 §7.1, §2.1). */
export const METHOD_PASSKEY_COSE_KEY_TYPE_EC2 = 2;
export const METHOD_PASSKEY_COSE_ALGORITHM_ES256 = -7;
export const METHOD_PASSKEY_COSE_CURVE_P256 = 1;

/** The COSE key map labels, spelled as the decoded map's keys. */
export const METHOD_PASSKEY_COSE_LABEL_KEY_TYPE = '1';
export const METHOD_PASSKEY_COSE_LABEL_ALGORITHM = '3';
export const METHOD_PASSKEY_COSE_LABEL_CURVE = '-1';
export const METHOD_PASSKEY_COSE_LABEL_X = '-2';
export const METHOD_PASSKEY_COSE_LABEL_Y = '-3';

/** The byte length of each P-256 coordinate. */
export const METHOD_PASSKEY_P256_COORDINATE_LENGTH = 32;

/** The prefix byte of an uncompressed public key. */
export const METHOD_PASSKEY_UNCOMPRESSED_POINT_PREFIX = 4;

/**
 * The exact bytes an assertion's client data must begin with, as the deployed module requires: the type, then the
 * challenge member up to the opening quote of its value. The digest's unpadded base64url and a closing quote follow.
 */
export const METHOD_PASSKEY_CLIENT_DATA_PREFIX = '{"type":"webauthn.get","challenge":"';

/** The quote that closes the challenge value right after the digest's base64url. */
export const METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_CLOSE = '"';

/** The client data member names whose positions ox is handed. */
export const METHOD_PASSKEY_CLIENT_DATA_TYPE_KEY = 'type';
export const METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_KEY = 'challenge';

/** Where the type member starts inside the required prefix. */
export const METHOD_PASSKEY_CLIENT_DATA_TYPE_INDEX = METHOD_PASSKEY_CLIENT_DATA_PREFIX.indexOf(`"${METHOD_PASSKEY_CLIENT_DATA_TYPE_KEY}"`);

/** Where the challenge member starts inside the required prefix. */
export const METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_INDEX = METHOD_PASSKEY_CLIENT_DATA_PREFIX.indexOf(
  `"${METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_KEY}"`,
);

/** The member of a WebAuthn credential holding the authenticator's response. */
export const METHOD_PASSKEY_RESPONSE_MEMBER = 'response';

/** The member of a creation's response holding the CBOR attestation object. */
export const METHOD_PASSKEY_ATTESTATION_OBJECT_MEMBER = 'attestationObject';

/** The member of the decoded attestation object holding the authenticator data. */
export const METHOD_PASSKEY_AUTH_DATA_MEMBER = 'authData';

/** The members of an assertion's response the proof is read from. */
export const METHOD_PASSKEY_AUTHENTICATOR_DATA_MEMBER = 'authenticatorData';
export const METHOD_PASSKEY_CLIENT_DATA_JSON_MEMBER = 'clientDataJSON';
export const METHOD_PASSKEY_SIGNATURE_MEMBER = 'signature';

/** The tag `Object.prototype.toString` gives an `ArrayBuffer` from any realm. */
export const METHOD_PASSKEY_ARRAY_BUFFER_TAG = '[object ArrayBuffer]';

/** The attestation a creation asks for. */
export const METHOD_PASSKEY_ATTESTATION = 'none';

/** The user verification every ceremony requires. */
export const METHOD_PASSKEY_USER_VERIFICATION = 'required';

/** The authenticator selection every creation asks for. */
export const METHOD_PASSKEY_AUTHENTICATOR_SELECTION = Object.freeze({
  residentKey: 'required',
  requireResidentKey: true,
  userVerification: METHOD_PASSKEY_USER_VERIFICATION,
} as const);
