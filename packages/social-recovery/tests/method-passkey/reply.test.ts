import { decodeAbiParameters, hexToString } from 'viem';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import { REPLY_FAILURE_CAUSES, type Hex, type Input } from '../../src/interfaces';
import {
  assertionParts,
  assertionRecord,
  base64url,
  bufferOf,
  bytesOf,
  configOfKey,
  credentialIdOf,
  ctxFor,
  derOf,
  FLAG_UP,
  FLAG_UV,
  freshKey,
  HALF_N,
  hexOf,
  N,
  parseDer,
  utf8,
} from './fixtures';

const method = passkeyMethod();
const rpId = 'wallet.example';
const key = freshKey();
const config = configOfKey(key, rpId);
const ctx = ctxFor(config);
const challenge = bytesOf(ctx.digest);

type RequestOptions = {
  readonly publicKey: {
    readonly challenge: Uint8Array;
    readonly rpId: string;
    readonly userVerification: string;
    readonly allowCredentials?: readonly { readonly 'id': Uint8Array; readonly type: string }[];
  };
};

const optionsOf = (input: Input): RequestOptions => input['options'] as RequestOptions;

const decodeProof = (proof: Hex) => {
  const [authenticatorData, clientData, r, s] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes' }, { type: 'uint256' }, { type: 'uint256' }],
    proof,
  );

  return { authenticatorData, clientDataJSON: hexToString(clientData), r, s };
};

const expectFailure = (value: unknown): void => {
  expect(value).toMatchObject({ kind: 'reply-failure' });
  expect(REPLY_FAILURE_CAUSES).toContain((value as { cause: string }).cause);
};

describe('signingInput', () => {
  it('puts the digest as the challenge, under the parameter\'s rp id, UV required', () => {
    const { publicKey } = optionsOf(method.signingInput(ctx, { relyingPartyId: rpId }));

    expect(hexOf(publicKey.challenge)).toBe(ctx.digest.toLowerCase());
    expect(publicKey.rpId).toBe(rpId);
    expect(publicKey.userVerification).toBe('required');
  });

  it('is discoverable where no credential id is given', () => {
    expect(optionsOf(method.signingInput(ctx, { relyingPartyId: rpId })).publicKey.allowCredentials).toBeUndefined();
  });

  it('names the credential in allowCredentials where the integrator has it (the browser\'s base64url id)', () => {
    const credentialId = credentialIdOf(3);
    const { publicKey } = optionsOf(method.signingInput(ctx, { relyingPartyId: rpId, credentialId: base64url(credentialId) }));

    expect(publicKey.allowCredentials).toHaveLength(1);
    expect(publicKey.allowCredentials?.[0]?.type).toBe('public-key');
    expect(new Uint8Array(publicKey.allowCredentials?.[0]?.['id'] ?? [])).toEqual(credentialId);
  });

  it('follows the ctx: another place is another challenge', () => {
    const other = ctxFor(config, { place: 2 });

    expect(hexOf(optionsOf(method.signingInput(other, { relyingPartyId: rpId })).publicKey.challenge)).toBe(
      other.digest.toLowerCase(),
    );
    expect(other.digest).not.toBe(ctx.digest);
  });

  it('refuses a missing rp id by throwing, before any device is asked', () => {
    expect(() => method.signingInput(ctx)).toThrow();
    expect(() => method.signingInput(ctx, {})).toThrow();
    expect(() => method.signingInput(ctx, { relyingPartyId: '' })).toThrow();
  });
});

describe('replyFrom', () => {
  const input = method.signingInput(ctx, { relyingPartyId: rpId });

  it('packages authenticator data, client data JSON, r and s from the browser\'s assertion', async () => {
    const parts = assertionParts(key, rpId, challenge, { pick: (der) => parseDer(der).s <= HALF_N });
    const proof = (await method.replyFrom(ctx, input, { assertion: assertionRecord(parts) })) as Hex;
    const { r, s } = parseDer(parts.signature);

    expect(decodeProof(proof)).toEqual({
      authenticatorData: hexOf(parts.authenticatorData),
      clientDataJSON: parts.clientDataJSON,
      r,
      s,
    });
    expect(await method.verify(ctx, proof)).toBe('satisfied');
  });

  it('lowers a high s to n - s', async () => {
    const parts = assertionParts(key, rpId, challenge, { pick: (der) => parseDer(der).s > HALF_N });
    const { r, s } = parseDer(parts.signature);
    const proof = (await method.replyFrom(ctx, input, { assertion: assertionRecord(parts) })) as Hex;

    expect(s > HALF_N).toBe(true);
    expect(decodeProof(proof).r).toBe(r);
    expect(decodeProof(proof).s).toBe(N - s);
    expect(await method.verify(ctx, proof)).toBe('satisfied');
  });

  it('reads a DER r of 31 bytes correctly', async () => {
    const parts = assertionParts(key, rpId, challenge, { pick: (der) => parseDer(der).rLength === 31 });
    const proof = (await method.replyFrom(ctx, input, { assertion: assertionRecord(parts) })) as Hex;
    const { r } = parseDer(parts.signature);

    expect(decodeProof(proof).r).toBe(r);
    expect(await method.verify(ctx, proof)).toBe('satisfied');
  });

  it('keeps an extra client-data field and verifies', async () => {
    const parts = assertionParts(key, rpId, challenge, { extra: { extra: 'kept' } });
    const proof = (await method.replyFrom(ctx, input, { assertion: assertionRecord(parts) })) as Hex;

    expect(decodeProof(proof).clientDataJSON).toBe(parts.clientDataJSON);
    expect(await method.verify(ctx, proof)).toBe('satisfied');
  });

  it('runs the local check before returning: each failing assertion is a typed ReplyFailure', async () => {
    const other = freshKey();
    const cases = {
      'wrong challenge': assertionParts(key, rpId, bytesOf(ctxFor(config, { place: 2 }).digest)),
      'another rp id': assertionParts(key, 'other.example', challenge),
      'missing UV': assertionParts(key, rpId, challenge, { flags: FLAG_UP }),
      'missing UP': assertionParts(key, rpId, challenge, { flags: FLAG_UV }),
      'wrong type': assertionParts(key, rpId, challenge, { type: 'webauthn.create' }),
      'another key': assertionParts(other, rpId, challenge),
    };

    for (const [name, parts] of Object.entries(cases)) {
      const result = await method.replyFrom(ctx, input, { assertion: assertionRecord(parts) });

      expect(typeof result, name).toBe('object');
      expectFailure(result);
    }
  });

  it('a signature over other bytes is a typed ReplyFailure', async () => {
    const parts = assertionParts(key, rpId, challenge);
    const { r, s } = parseDer(parts.signature);
    const tampered = { ...parts, signature: derOf(r, s ^ 1n) };

    expectFailure(await method.replyFrom(ctx, input, { assertion: assertionRecord(tampered) }));
  });

  it('malformed material is a typed failure, never a throw', async () => {
    const good = assertionRecord(assertionParts(key, rpId, challenge));
    const materials: unknown[] = [
      undefined,
      {},
      { assertion: null },
      { assertion: {} },
      { assertion: { response: {} } },
      { assertion: { ...good, response: { ...good.response, signature: bufferOf(Uint8Array.of(0x30, 0x02, 0x02, 0x00)) } } },
      { assertion: { ...good, response: { ...good.response, signature: 'MEUCIQ' } } },
      { assertion: { ...good, response: { ...good.response, clientDataJSON: bufferOf(Uint8Array.of(0xff, 0xfe)) } } },
      { assertion: { ...good, response: { ...good.response, authenticatorData: bufferOf(new Uint8Array(10)) } } },
      { assertion: { ...good, response: { ...good.response, clientDataJSON: bufferOf(utf8('not json')) } } },
    ];

    for (const material of materials) {
      await expect(method.replyFrom(ctx, input, material as Parameters<typeof method.replyFrom>[2])).resolves.toMatchObject({
        kind: 'reply-failure',
      });
    }
  });

  it('a ctx whose config does not decode is a typed failure', async () => {
    const good = assertionRecord(assertionParts(key, rpId, challenge));
    const broken = ctxFor('0x1234', { digest: ctx.digest });

    expectFailure(await method.replyFrom(broken, input, { assertion: good }));
  });

  it('accepts the browser buffers as Uint8Array views as well as ArrayBuffers', async () => {
    const parts = assertionParts(key, rpId, challenge);
    const record = assertionRecord(parts);
    const views = {
      ...record,
      response: {
        ...record.response,
        authenticatorData: new Uint8Array(record.response.authenticatorData),
        clientDataJSON: new Uint8Array(record.response.clientDataJSON),
        signature: new Uint8Array(record.response.signature),
      },
    };
    const proof = await method.replyFrom(ctx, input, { assertion: views });

    expect(await method.verify(ctx, proof as Hex)).toBe('satisfied');
  });
});
