import { base64url, utf8 } from './fixtures';

/** The bytes the deployed passkey module requires client data to begin with, up to the challenge's opening quote. */
export const CHAIN_CLIENT_DATA_PREFIX = '{"type":"webauthn.get","challenge":"';

/** The deployed module's client data check, restated: the text's UTF-8 bytes begin with the prefix, the unpadded base64url digest and a quote. */
export const chainAcceptsClientData = (text: string, digest: Uint8Array): boolean => {
  const bytes = utf8(text);
  const expected = utf8(`${CHAIN_CLIENT_DATA_PREFIX}${base64url(digest)}"`);

  return bytes.length >= expected.length && expected.every((byte, index) => bytes[index] === byte);
};
