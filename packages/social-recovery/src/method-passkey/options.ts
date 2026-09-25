import * as WebAuthnP256 from 'ox/WebAuthnP256';
import { METHOD_PASSKEY_ATTESTATION, METHOD_PASSKEY_AUTHENTICATOR_SELECTION, METHOD_PASSKEY_USER_VERIFICATION } from '../constants';
import type { Hex } from '../interfaces';

/** The creation options for a discoverable, user-verified credential under the relying-party id, without attestation. */
export const creationOptions = (relyingPartyId: string, userName: string): WebAuthnP256.CredentialCreationOptions =>
  WebAuthnP256.getCredentialCreationOptions({
    attestation: METHOD_PASSKEY_ATTESTATION,
    authenticatorSelection: { ...METHOD_PASSKEY_AUTHENTICATOR_SELECTION },
    name: userName,
    rp: { 'id': relyingPartyId, name: relyingPartyId },
  });

/** The request options with the digest as the challenge, limited to the credential id when one is given. */
export const requestOptions = (
  digest: Hex,
  relyingPartyId: string,
  credentialId: string | undefined,
): WebAuthnP256.CredentialRequestOptions =>
  WebAuthnP256.getCredentialRequestOptions({
    challenge: digest,
    rpId: relyingPartyId,
    userVerification: METHOD_PASSKEY_USER_VERIFICATION,
    ...(credentialId === undefined ? {} : { credentialId }),
  });
