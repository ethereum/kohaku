import { createPublicKey, verify as nodeVerify } from 'node:crypto';
import { decodeAbiParameters, hexToString } from 'viem';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import type { Hex } from '../../src/interfaces';
import { checkAssertion } from '../../src/method-passkey/check';
import { decodePasskeyConfig, decodePasskeyProof } from '../../src/method-passkey/codec';
import {
  assertionRecord,
  type AssertionParts,
  authenticatorData,
  base64url,
  bytesOf,
  concat,
  configOfKey,
  ctxFor,
  FLAG_UP,
  FLAG_UV,
  freshKey,
  HALF_N,
  type Key,
  parseDer,
  proofBytes,
  sha256,
  signAssertion,
  word,
} from './fixtures';

const method = passkeyMethod();
const rpId = 'wallet.example';
const key = freshKey();
const config = configOfKey(key, rpId);
const ctx = ctxFor(config);
const expected = base64url(bytesOf(ctx.digest));
const input = method.signingInput(ctx, { relyingPartyId: rpId });

/** Signs this exact text as client data, retrying the counter until s is already low. */
const signed = (text: string): AssertionParts => {
  for (let counter = 1; counter < 10_000; counter += 1) {
    const authData = authenticatorData(rpId, FLAG_UP | FLAG_UV, counter);
    const signature = signAssertion(key, authData, text);

    if (parseDer(signature).s <= HALF_N) return { authenticatorData: authData, clientDataJSON: text, signature };
  }

  throw new Error('no low-s signature');
};

const proofOf = (parts: AssertionParts): Hex => {
  const { r, s } = parseDer(parts.signature);

  return proofBytes(parts.authenticatorData, parts.clientDataJSON, r, s);
};

/** node:crypto's own verdict on the signature over the exact text, so a rejection is the document's alone. */
const signatureHoldsOverExactText = (signer: Key, parts: AssertionParts): boolean => {
  const publicKey = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: Buffer.from(word(signer.x)).toString('base64url'),
      y: Buffer.from(word(signer.y)).toString('base64url'),
    },
    format: 'jwk',
  });

  return nodeVerify(
    'sha256',
    concat(parts.authenticatorData, sha256(parts.clientDataJSON)),
    { key: publicKey, dsaEncoding: 'der' },
    parts.signature,
  );
};

const judge = async (text: string) => {
  const parts = signed(text);
  const proof = proofOf(parts);

  return {
    parts,
    signatureValid: signatureHoldsOverExactText(key, parts),
    check: checkAssertion(decodePasskeyConfig(config), ctx.digest, decodePasskeyProof(proof)),
    verdict: await method.verify(ctx, proof),
    reply: await method.replyFrom(ctx, input, { assertion: assertionRecord(parts) }),
  };
};

const tail = '"origin":"https://wallet.example","crossOrigin":false';

describe('client data: only top-level members count, and only one well-formed object', () => {
  const rejected: readonly (readonly [string, string, string])[] = [
    [
      'the expected type and challenge nested under "extra", the top-level ones wrong',
      `{"extra":{"type":"webauthn.get","challenge":"${expected}"},"type":"webauthn.create","challenge":"wrong",${tail}}`,
      'client-data-type',
    ],
    [
      'type and challenge only nested, none at the top level',
      `{"extra":{"type":"webauthn.get","challenge":"${expected}"},${tail}}`,
      'client-data-type',
    ],
    [
      'a nested type alone beside a correct top-level challenge',
      `{"challenge":"${expected}","inner":{"type":"webauthn.get"},${tail}}`,
      'client-data-type',
    ],
    [
      'duplicate top-level type, good first and bad last',
      `{"type":"webauthn.get","challenge":"${expected}",${tail},"type":"webauthn.create"}`,
      'client-data-malformed',
    ],
    [
      'duplicate top-level type, bad first and good last',
      `{"type":"webauthn.create","challenge":"${expected}",${tail},"type":"webauthn.get"}`,
      'client-data-malformed',
    ],
    [
      'duplicate top-level challenge with conflicting values',
      `{"type":"webauthn.get","challenge":"${expected}",${tail},"challenge":"wrong"}`,
      'client-data-malformed',
    ],
    [
      'a duplicate type spelled with an escape, \\u0074ype',
      `{"type":"webauthn.get","challenge":"${expected}",${tail},"\\u0074ype":"webauthn.create"}`,
      'client-data-malformed',
    ],
    [
      'a valid object followed by garbage',
      `{"type":"webauthn.get","challenge":"${expected}",${tail}}garbage`,
      'client-data-malformed',
    ],
    [
      'a valid object followed by whitespace (stricter than JSON.parse)',
      `{"type":"webauthn.get","challenge":"${expected}",${tail}} `,
      'client-data-malformed',
    ],
    [
      'a valid object followed by a newline',
      `{"type":"webauthn.get","challenge":"${expected}",${tail}}\n`,
      'client-data-malformed',
    ],
    [
      'a valid object preceded by whitespace',
      ` {"type":"webauthn.get","challenge":"${expected}",${tail}}`,
      'client-data-malformed',
    ],
  ];

  for (const [name, text, reason] of rejected) {
    it(`${name}: validly signed, still ${reason}, rejected, and a typed ReplyFailure`, async () => {
      const outcome = await judge(text);

      expect(outcome.signatureValid).toBe(true);
      expect(outcome.check).toBe(reason);
      expect(outcome.verdict).toBe('rejected');
      expect(outcome.reply).toEqual({ kind: 'reply-failure', cause: 'material-rejected' });
    });
  }

  it('the escaped spelling really is a duplicate name to JSON.parse, which keeps the last', () => {
    const text = `{"type":"webauthn.get","\\u0074ype":"webauthn.create"}`;

    expect(JSON.parse(text)).toEqual({ type: 'webauthn.create' });
  });

  const satisfied: readonly (readonly [string, string])[] = [
    [
      'the first member is a nested object holding "type":"x"',
      `{"note":{"type":"x"},"type":"webauthn.get","challenge":"${expected}",${tail}}`,
    ],
    [
      'the first member nests a full wrong type and challenge',
      `{"note":{"type":"webauthn.create","challenge":"wrong"},"type":"webauthn.get","challenge":"${expected}",${tail}}`,
    ],
    [
      'extra top-level members in an unusual order, spaced and escaped, type and challenge last',
      `{"crossOrigin":false, "zeta": [1, {"type": "n", "challenge": "m"}], "origin":"https://wallet.example","al\\u0070ha":"x\\"y","challenge":"${expected}","type":"webauthn.get"}`,
    ],
    [
      'an unrelated top-level key repeated is still permitted',
      `{"type":"webauthn.get","challenge":"${expected}","origin":"a","origin":"b"}`,
    ],
  ];

  for (const [name, text] of satisfied) {
    it(`${name}: ok, satisfied, and the reply carries the exact bytes`, async () => {
      const outcome = await judge(text);

      expect(outcome.signatureValid).toBe(true);
      expect(outcome.check).toBe('ok');
      expect(outcome.verdict).toBe('satisfied');
      expect(typeof outcome.reply).toBe('string');

      const [, clientData] = decodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes' }, { type: 'uint256' }, { type: 'uint256' }],
        outcome.reply as Hex,
      );

      expect(hexToString(clientData)).toBe(text);
      expect(outcome.reply).toBe(proofOf(outcome.parts));
    });
  }

  it('the signed hash is over the original text: a re-serialised document differs and the signature over the original is what verifies', async () => {
    const text = satisfied[2]?.[1] ?? '';
    const reserialised = JSON.stringify(JSON.parse(text));
    const parts = signed(text);

    expect(reserialised).not.toBe(text);
    expect(Buffer.from(sha256(reserialised)).equals(Buffer.from(sha256(text)))).toBe(false);
    expect(await method.verify(ctx, proofOf(parts))).toBe('satisfied');

    // The same signature presented with the re-serialised text fails the signature, not the document.
    const swapped = { ...parts, clientDataJSON: reserialised };

    expect(checkAssertion(decodePasskeyConfig(config), ctx.digest, decodePasskeyProof(proofOf(swapped)))).toBe('signature-invalid');
    expect(await method.verify(ctx, proofOf(swapped))).toBe('rejected');
  });
});
