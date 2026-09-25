import * as Signature from 'ox/Signature';
import { METHOD_PASSKEY_P256_HALF_ORDER, METHOD_PASSKEY_P256_ORDER } from '../constants';
import type { PasskeyProof } from '../types';
import { bufferBytes, hexOf, memberOf, utf8Text } from './bytes';

/** `n - s` for an `s` above `floor(n / 2)`, so the proof holds a low `s` whatever the authenticator signed. */
export const lowS = (s: bigint): bigint => (s > METHOD_PASSKEY_P256_HALF_ORDER && s < METHOD_PASSKEY_P256_ORDER ? METHOD_PASSKEY_P256_ORDER - s : s);

const derSignature = (bytes: Uint8Array): { r: bigint; s: bigint } | undefined => {
  try {
    const { r, s } = Signature.fromDerBytes(bytes);

    return { r, s };
  } catch {
    return undefined;
  }
};

/** The proof a `navigator.credentials.get` result holds, or undefined where it is unreadable; the check list judges it. */
export const readAssertion = (assertion: unknown): PasskeyProof | undefined => {
  const response = memberOf(assertion, 'response');
  const authenticatorData = bufferBytes(memberOf(response, 'authenticatorData'));
  const clientDataBytes = bufferBytes(memberOf(response, 'clientDataJSON'));
  const signatureBytes = bufferBytes(memberOf(response, 'signature'));

  if (authenticatorData === undefined || clientDataBytes === undefined || signatureBytes === undefined) {
    return undefined;
  }

  const clientDataJSON = utf8Text(clientDataBytes);
  const signature = derSignature(signatureBytes);

  if (clientDataJSON === undefined || signature === undefined) return undefined;

  return { authenticatorData: hexOf(authenticatorData), clientDataJSON, r: signature.r, s: lowS(signature.s) };
};
