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

/** The type an assertion's client data carries (WebAuthn L2 §5.8.1). */
export const METHOD_PASSKEY_WEBAUTHN_GET_TYPE = 'webauthn.get';

/** The client data member names the check reads. */
export const METHOD_PASSKEY_CLIENT_DATA_TYPE_KEY = 'type';
export const METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_KEY = 'challenge';

/** The exact type member an assertion's client data carries. */
export const METHOD_PASSKEY_CLIENT_DATA_ASSERTION_TYPE_MEMBER = `"${METHOD_PASSKEY_CLIENT_DATA_TYPE_KEY}":"${METHOD_PASSKEY_WEBAUTHN_GET_TYPE}"`;

/** The opening of the challenge member, which the digest's base64url text and a closing quote follow. */
export const METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_MEMBER_PREFIX = `"${METHOD_PASSKEY_CLIENT_DATA_CHALLENGE_KEY}":"`;

/** Matches a JSON string or a structural character, skipping numbers and literals. */
export const METHOD_PASSKEY_CLIENT_DATA_TOKEN = /"(?:[^"\\]|\\.)*"|[{}[\],]/g;

/** The structural characters that open and close a JSON object or array. */
export const METHOD_PASSKEY_CLIENT_DATA_OPENERS: ReadonlySet<string> = new Set(['{', '[']);
export const METHOD_PASSKEY_CLIENT_DATA_CLOSERS: ReadonlySet<string> = new Set(['}', ']']);

/** The tag `Object.prototype.toString` gives an `ArrayBuffer` from any realm. */
export const METHOD_PASSKEY_ARRAY_BUFFER_TAG = '[object ArrayBuffer]';

/** The attestation a creation asks for. */
export const METHOD_PASSKEY_ATTESTATION = 'none';

/** The user verification every ceremony requires. */
export const METHOD_PASSKEY_USER_VERIFICATION = 'required';

/** The authenticator selection every creation asks for. */
export const METHOD_PASSKEY_AUTHENTICATOR_SELECTION = {
  residentKey: 'required',
  requireResidentKey: true,
  userVerification: METHOD_PASSKEY_USER_VERIFICATION,
} as const;
