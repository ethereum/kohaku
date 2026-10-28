import { createPublicKey, verify as nodeVerify } from 'node:crypto';
import { decodeAbiParameters, hexToString } from 'viem';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import type { Ctx, Hex } from '../../src/interfaces';
import { CHAIN_CLIENT_DATA_PREFIX, chainAcceptsClientData } from './chain-model';
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
const prefix = `${CHAIN_CLIENT_DATA_PREFIX}${expected}"`;

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

const judge = async (text: string, under: Ctx = ctx) => {
  const parts = signed(text);
  const proof = proofOf(parts);
  const input = method.signingInput(under, { relyingPartyId: rpId });

  return {
    parts,
    signatureValid: signatureHoldsOverExactText(key, parts),
    chain: chainAcceptsClientData(text, bytesOf(under.digest)),
    verdict: await method.verify(under, proof),
    reply: await method.replyFrom(under, input, { assertion: assertionRecord(parts) }),
  };
};

const REFUSED = { kind: 'reply-failure', cause: 'material-rejected' };

const tail = '"origin":"https://wallet.example","crossOrigin":false';

describe('client data: the exact opening the chain requires', () => {
  it('the opening is the type member, then the challenge member holding the unpadded base64url digest and its closing quote', () => {
    expect(prefix).toBe(`{"type":"webauthn.get","challenge":"${expected}"`);
    expect(expected).toHaveLength(43);
    expect(expected).not.toMatch(/[=+/]/);
  });

  const satisfied: readonly (readonly [string, string])[] = [
    ['the opening and the browser\'s usual members', `${prefix},${tail}}`],
    ['the opening alone, closed at once', `${prefix}}`],
    [
      'the opening, then Chrome\'s own extra member',
      `${prefix},${tail},"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}`,
    ],
    ['the opening, then a nested object holding other type and challenge members', `${prefix},"note":{"type":"webauthn.create","challenge":"wrong"},${tail}}`],
    ['the opening, then an unrelated member repeated', `${prefix},"origin":"a","origin":"b"}`],
  ];

  for (const [name, text] of satisfied) {
    it(`${name}: the chain accepts it, verify is satisfied, and the reply carries the exact bytes`, async () => {
      const outcome = await judge(text);

      expect(outcome.signatureValid).toBe(true);
      expect(outcome.chain).toBe(true);
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

  const rejected: readonly (readonly [string, string])[] = [
    ['the first member is a nested object holding "type":"x" (accepted before, refused on chain)', `{"note":{"type":"x"},"type":"webauthn.get","challenge":"${expected}",${tail}}`],
    [
      'the first member nests a full wrong type and challenge (accepted before, refused on chain)',
      `{"note":{"type":"webauthn.create","challenge":"wrong"},"type":"webauthn.get","challenge":"${expected}",${tail}}`,
    ],
    [
      'extra members first, spaced and escaped, challenge and type last (accepted before, refused on chain)',
      `{"crossOrigin":false, "zeta": [1, {"type": "n", "challenge": "m"}], "origin":"https://wallet.example","al\\u0070ha":"x\\"y","challenge":"${expected}","type":"webauthn.get"}`,
    ],
    ['the members reordered: challenge first, then type', `{"challenge":"${expected}","type":"webauthn.get",${tail}}`],
    ['the challenge with base64 padding', `{"type":"webauthn.get","challenge":"${expected}=",${tail}}`],
    ['one leading space', ` ${prefix},${tail}}`],
    ['a leading newline', `\n${prefix},${tail}}`],
    ['a leading byte-order mark', `\uFEFF${prefix},${tail}}`],
    ['the type member\'s name upper-cased', `{"TYPE":"webauthn.get","challenge":"${expected}",${tail}}`],
    ['the type value upper-cased', `{"type":"WEBAUTHN.GET","challenge":"${expected}",${tail}}`],
    ['a space after a colon in the opening', `{"type": "webauthn.get","challenge":"${expected}",${tail}}`],
    ['a space after the comma in the opening', `{"type":"webauthn.get", "challenge":"${expected}",${tail}}`],
    ['a newline after the brace', `{\n"type":"webauthn.get","challenge":"${expected}",${tail}}`],
    ['the type spelled with an escape, \\u0074ype', `{"\\u0074ype":"webauthn.get","challenge":"${expected}",${tail}}`],
    ['the challenge not followed by its closing quote', `{"type":"webauthn.get","challenge":"${expected},${tail}}`],
    ['the challenge with one more character', `{"type":"webauthn.get","challenge":"${expected}A",${tail}}`],
    ['the challenge one character short', `{"type":"webauthn.get","challenge":"${expected.slice(0, -1)}",${tail}}`],
    ['the creation type', `{"type":"webauthn.create","challenge":"${expected}",${tail}}`],
    ['a member between type and challenge', `{"type":"webauthn.get","origin":"https://wallet.example","challenge":"${expected}","crossOrigin":false}`],
    ['the expected type and challenge nested under "extra", the top-level ones wrong', `{"extra":{"type":"webauthn.get","challenge":"${expected}"},"type":"webauthn.create","challenge":"wrong",${tail}}`],
    ['type and challenge only nested', `{"extra":{"type":"webauthn.get","challenge":"${expected}"},${tail}}`],
    ['a duplicate type, the bad one first', `{"type":"webauthn.create","challenge":"${expected}",${tail},"type":"webauthn.get"}`],
    ['the opening cut before the closing quote', `${CHAIN_CLIENT_DATA_PREFIX}${expected}`],
    ['empty text', ''],
  ];

  for (const [name, text] of rejected) {
    it(`${name}: validly signed, the chain refuses it, verify is rejected and replyFrom a typed failure`, async () => {
      const outcome = await judge(text);

      expect(outcome.signatureValid).toBe(true);
      expect(outcome.chain).toBe(false);
      expect(outcome.verdict).toBe('rejected');
      expect(outcome.reply).toEqual(REFUSED);
    });
  }

  it('the standard base64 alphabet in place of the url alphabet is rejected, the url spelling satisfied', async () => {
    const digest = `0x${'fb'.repeat(32)}` as Hex;
    const under = ctxFor(config, { digest });
    const url = Buffer.from(bytesOf(digest)).toString('base64url');
    const standard = Buffer.from(bytesOf(digest)).toString('base64').replace(/=+$/, '');

    expect(url).not.toBe(standard);
    expect((await judge(`{"type":"webauthn.get","challenge":"${standard}",${tail}}`, under)).verdict).toBe('rejected');
    expect((await judge(`{"type":"webauthn.get","challenge":"${url}",${tail}}`, under)).verdict).toBe('satisfied');
  });

  it('the signed hash is over the original text: the same signature over a re-serialised document is rejected', async () => {
    const text = `${prefix}, "origin" : "https://wallet.example"}`;
    const reserialised = JSON.stringify(JSON.parse(text));
    const parts = signed(text);

    expect(reserialised).not.toBe(text);
    expect(await method.verify(ctx, proofOf(parts))).toBe('satisfied');
    expect(await method.verify(ctx, proofOf({ ...parts, clientDataJSON: reserialised }))).toBe('rejected');
  });
});

describe('client data: what follows the opening, which the chain signs but does not read', () => {
  const unruled: readonly (readonly [string, string])[] = [
    ['trailing whitespace after the object', `${prefix},${tail}} `],
    ['a trailing newline after the object', `${prefix},${tail}}\n`],
    ['garbage after the object', `${prefix},${tail}}garbage`],
    ['a second challenge after the opening', `${prefix},${tail},"challenge":"wrong"}`],
    ['a second type after the opening', `${prefix},${tail},"type":"webauthn.create"}`],
    ['a second type spelled with an escape', `${prefix},${tail},"\\u0074ype":"webauthn.create"}`],
    ['bytes that are not JSON right after the opening', `${prefix}garbage`],
    ['the opening and nothing more', prefix],
  ];

  for (const [name, text] of unruled) {
    it(`${name}: the chain accepts it; verify and replyFrom agree, and the SDK is never wider`, async () => {
      const outcome = await judge(text);

      expect(outcome.signatureValid).toBe(true);
      expect(outcome.chain).toBe(true);
      expect(['satisfied', 'rejected']).toContain(outcome.verdict);

      if (outcome.verdict === 'satisfied') expect(outcome.reply).toBe(proofOf(outcome.parts));
      else expect(outcome.reply).toEqual(REFUSED);
    });
  }
});
