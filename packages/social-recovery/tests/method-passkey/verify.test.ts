import { createPublicKey, verify as nodeVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import type { Hex } from '../../src/interfaces';
import { readVector } from '../kat/read-vector';
import {
  assertionParts,
  type AssertionParts,
  base64url,
  bytesOf,
  CONFIG_FILE,
  type ConfigVectorFile,
  concat,
  configBytes,
  configOfKey,
  ctxFor,
  derOf,
  FLAG_ED,
  FLAG_UP,
  FLAG_UV,
  freshKey,
  HALF_N,
  N,
  parseDer,
  PROOF_FILE,
  type ProofVectorFile,
  proofBytes,
  sha256,
  signAssertion,
  cbor,
  authenticatorData,
  clientDataJSON,
} from './fixtures';

const method = passkeyMethod();
const configFile = readVector(CONFIG_FILE) as unknown as ConfigVectorFile;
const proofFile = readVector(PROOF_FILE) as unknown as ProofVectorFile;

/** The proof bytes packaged by hand, with a high s lowered unless `keepHighS`. */
const proofOf = (parts: AssertionParts, options: { keepHighS?: boolean } = {}): Hex => {
  const { r, s } = parseDer(parts.signature);
  const lowered = !options.keepHighS && s > HALF_N ? N - s : s;

  return proofBytes(parts.authenticatorData, parts.clientDataJSON, r, lowered);
};

const EXPECTED_VERDICTS: Record<string, 'satisfied' | 'rejected'> = {
  'valid-extra-client-field': 'satisfied',
  'missing-user-verification': 'rejected',
  'missing-user-presence': 'rejected',
  'wrong-challenge': 'rejected',
  'wrong-client-data-type': 'rejected',
  'wrong-relying-party-hash': 'rejected',
};

describe('the blessed proof rows', () => {
  const configRow = configFile.vectors[0];
  const config = (configRow?.expected.encoded ?? '0x') as Hex;
  const rows = proofFile.vectors;

  it('names exactly the rows this test judges', () => {
    expect(rows.map((row) => row['id']).sort()).toEqual(Object.keys(EXPECTED_VERDICTS).sort());
  });

  for (const row of rows) {
    const verdict = row.expected.verification ? 'satisfied' : 'rejected';

    it(`${row['id']}: the file names ${verdict}`, () => {
      expect(verdict).toBe(EXPECTED_VERDICTS[row['id']]);
    });

    it(`${row['id']}: the raw P-256 signature verifies under the config row's key, so the verdict is the named check's`, () => {
      const publicKey = createPublicKey({
        key: {
          kty: 'EC',
          crv: 'P-256',
          x: base64url(bytesOf(BigInt(configRow?.input.x ?? '0').toString(16).padStart(64, '0'))),
          y: base64url(bytesOf(BigInt(configRow?.input.y ?? '0').toString(16).padStart(64, '0'))),
        },
        format: 'jwk',
      });
      const message = concat(bytesOf(row.input.authenticatorData), sha256(row.input.clientDataJSON));
      const signature = derOf(BigInt(row.input.r), BigInt(row.input.s));

      expect(nodeVerify('sha256', message, publicKey, signature)).toBe(true);
    });

    it(`${row['id']}: verify answers ${verdict}`, async () => {
      const ctx = ctxFor(config, { digest: row.input.digest });

      expect(await method.verify(ctx, row.expected.encoded)).toBe(verdict);
    });
  }

  it('the valid row is rejected under another digest', async () => {
    const row = rows.find((candidate) => candidate['id'] === 'valid-extra-client-field');
    const ctx = ctxFor(config, { digest: `0x${'00'.repeat(31)}01` });

    expect(await method.verify(ctx, (row?.expected.encoded ?? '0x') as Hex)).toBe('rejected');
  });

  it('the challenge text of the valid row is the unpadded base64url of its digest', () => {
    const row = rows.find((candidate) => candidate['id'] === 'valid-extra-client-field');

    expect(base64url(bytesOf(row?.input.digest ?? '0x'))).toBe(row?.expected.challengeBase64url);
  });
});

describe('fresh assertions', () => {
  const key = freshKey();
  const rpId = 'wallet.example';
  const config = configOfKey(key, rpId);
  const ctx = ctxFor(config);
  const challenge = bytesOf(ctx.digest);

  it('an assertion under the enrolled rp id over the digest is satisfied', async () => {
    expect(await method.verify(ctx, proofOf(assertionParts(key, rpId, challenge)))).toBe('satisfied');
  });

  it('an assertion under another rp id is rejected', async () => {
    const proof = proofOf(assertionParts(key, 'other.example', challenge));

    expect(await method.verify(ctx, proof)).toBe('rejected');
  });

  it('a subdomain rp id is another hash and is rejected', async () => {
    const proof = proofOf(assertionParts(key, `login.${rpId}`, challenge));

    expect(await method.verify(ctx, proof)).toBe('rejected');
  });

  it('a wrong challenge is rejected', async () => {
    const proof = proofOf(assertionParts(key, rpId, sha256('another digest')));

    expect(await method.verify(ctx, proof)).toBe('rejected');
  });

  it('the digest rendered with padding or in the standard alphabet is rejected (compared as the unpadded base64url text)', async () => {
    // A digest whose base64url text holds `_` or `-`, so the standard alphabet differs.
    let digest: Hex = ctx.digest;

    for (let attempt = 0n; !/[-_]/.test(base64url(bytesOf(digest))); attempt += 1n) {
      digest = ctxFor(config, { attemptId: attempt }).digest;
    }

    const local = ctxFor(config, { digest });
    const standard = Buffer.from(bytesOf(digest)).toString('base64').replace(/=+$/, '');
    const padded = `${base64url(bytesOf(digest))}=`;

    for (const text of [standard, padded]) {
      const clientData = JSON.stringify({ type: 'webauthn.get', challenge: text, origin: 'https://wallet.example', crossOrigin: false });
      const authData = authenticatorData(rpId, FLAG_UP | FLAG_UV, 1);
      const parts = { authenticatorData: authData, clientDataJSON: clientData, signature: signAssertion(key, authData, clientData) };

      expect(await method.verify(local, proofOf(parts))).toBe('rejected');
    }

    expect(await method.verify(local, proofOf(assertionParts(key, rpId, bytesOf(digest))))).toBe('satisfied');
  });

  it('missing UV is rejected', async () => {
    expect(await method.verify(ctx, proofOf(assertionParts(key, rpId, challenge, { flags: FLAG_UP })))).toBe('rejected');
  });

  it('missing UP is rejected', async () => {
    expect(await method.verify(ctx, proofOf(assertionParts(key, rpId, challenge, { flags: FLAG_UV })))).toBe('rejected');
  });

  it('a client data type other than webauthn.get is rejected', async () => {
    const proof = proofOf(assertionParts(key, rpId, challenge, { type: 'webauthn.create' }));

    expect(await method.verify(ctx, proof)).toBe('rejected');
  });

  it('a proof carrying a high s is rejected, and the same signature with s lowered is satisfied', async () => {
    const parts = assertionParts(key, rpId, challenge);
    const { r, s } = parseDer(parts.signature);
    const low = s > HALF_N ? N - s : s;

    expect(await method.verify(ctx, proofBytes(parts.authenticatorData, parts.clientDataJSON, r, N - low))).toBe('rejected');
    expect(await method.verify(ctx, proofBytes(parts.authenticatorData, parts.clientDataJSON, r, low))).toBe('satisfied');
  });

  it('a signature whose DER r is 31 bytes is satisfied', async () => {
    const parts = assertionParts(key, rpId, challenge, { pick: (der) => parseDer(der).rLength === 31 });

    expect(parseDer(parts.signature).r < 1n << 248n).toBe(true);
    expect(await method.verify(ctx, proofOf(parts))).toBe('satisfied');
  });

  it('an extra client-data field still verifies, Chrome\'s own among them', async () => {
    const extras = [
      { extra: 'kept' },
      { other_keys_can_be_added_here: 'do not compare clientDataJSON against a template. See https://goo.gl/yabPex' },
      { topOrigin: 'https://wallet.example', tokenBinding: { status: 'present' } },
    ];

    for (const extra of extras) {
      expect(await method.verify(ctx, proofOf(assertionParts(key, rpId, challenge, { extra })))).toBe('satisfied');
    }
  });

  it('a synced passkey\'s backup flags (BE and BS beside UP and UV) still verify', async () => {
    expect(await method.verify(ctx, proofOf(assertionParts(key, rpId, challenge, { flags: 0x1d })))).toBe('satisfied');
  });

  it('authenticator data carrying extension data (ED) still verifies, since only the first 37 bytes are read', async () => {
    const authData = concat(authenticatorData(rpId, FLAG_UP | FLAG_UV | FLAG_ED, 9), cbor([['credProtect', 2]]));
    const clientData = clientDataJSON(challenge, { origin: 'https://wallet.example' });
    const parts = { authenticatorData: authData, clientDataJSON: clientData, signature: signAssertion(key, authData, clientData) };

    expect(await method.verify(ctx, proofOf(parts))).toBe('satisfied');
  });

  it('another key under the same rp id is rejected', async () => {
    const other = freshKey();

    expect(await method.verify(ctxFor(configOfKey(other, rpId)), proofOf(assertionParts(key, rpId, challenge)))).toBe('rejected');
  });

  it('a config point off the curve is rejected, not thrown', async () => {
    const offCurve = configBytes(key.x, key.y ^ 1n, `0x${Buffer.from(sha256(rpId)).toString('hex')}`);

    expect(await method.verify(ctxFor(offCurve), proofOf(assertionParts(key, rpId, bytesOf(ctxFor(offCurve).digest))))).toBe('rejected');
  });

  it('r or s of zero, and r at n, are rejected', async () => {
    const parts = assertionParts(key, rpId, challenge);
    const { r } = parseDer(parts.signature);

    expect(await method.verify(ctx, proofBytes(parts.authenticatorData, parts.clientDataJSON, 0n, 1n))).toBe('rejected');
    expect(await method.verify(ctx, proofBytes(parts.authenticatorData, parts.clientDataJSON, r, 0n))).toBe('rejected');
    expect(await method.verify(ctx, proofBytes(parts.authenticatorData, parts.clientDataJSON, N, 1n))).toBe('rejected');
  });

  it('never answers not-judged, whatever the request says about code', async () => {
    const proof = proofOf(assertionParts(key, rpId, challenge));
    const withCode = { ...ctx, request: { ...ctx.request, credentialHoldsCode: true } };

    expect(await method.verify(withCode, proof)).toBe('satisfied');
  });

  it('malformed proof or config bytes answer rejected and never throw', async () => {
    const good = proofOf(assertionParts(key, rpId, challenge));

    for (const proof of ['0x', '0x00', '0xzz', `${good}00`, good.slice(0, -2)] as Hex[]) {
      await expect(method.verify(ctx, proof)).resolves.toBe('rejected');
    }

    for (const bad of ['0x', `${config}00`, '0x1234'] as Hex[]) {
      await expect(method.verify(ctxFor(bad, { digest: ctx.digest }), good)).resolves.toBe('rejected');
    }
  });

  it('authenticator data shorter than 37 bytes is rejected', async () => {
    const parts = assertionParts(key, rpId, challenge);
    const short = parts.authenticatorData.subarray(0, 36);
    const signature = signAssertion(key, short, parts.clientDataJSON);
    const { r, s } = parseDer(signature);

    expect(await method.verify(ctx, proofBytes(short, parts.clientDataJSON, r, s > HALF_N ? N - s : s))).toBe('rejected');
  });
});
