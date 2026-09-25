import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import { REPLY_FAILURE_CAUSES, type EnrollInput, type Hex } from '../../src/interfaces';
import {
  bufferOf,
  bytesOf,
  cbor,
  configOfKey,
  coseKey,
  creation,
  ctxFor,
  FLAG_UP,
  FLAG_UV,
  freshKey,
  HALF_N,
  N,
  parseDer,
  proofBytes,
  assertionParts,
} from './fixtures';

const method = passkeyMethod();
const rpId = 'wallet.example';

type CreationOptions = {
  readonly publicKey: {
    readonly rp: { readonly 'id': string; readonly name?: string };
    readonly user: { readonly name: string };
    readonly challenge: Uint8Array;
    readonly pubKeyCredParams: readonly { readonly type: string; readonly alg: number }[];
    readonly authenticatorSelection: { readonly userVerification?: string; readonly residentKey?: string };
    readonly attestation: string;
  };
};

const optionsOf = (input: EnrollInput): CreationOptions => input['options'] as CreationOptions;

const expectFailure = (value: unknown): void => {
  expect(value).toMatchObject({ kind: 'reply-failure' });
  expect(REPLY_FAILURE_CAUSES).toContain((value as { cause: string }).cause);
  expect((value as { cause: string }).cause).toBe('material-rejected');
};

describe('enrollInput', () => {
  const input = method.enrollInput({ relyingPartyId: rpId, userName: 'alice' });

  it('is a ceremony', () => {
    expect(input.kind).toBe('ceremony');
  });

  it('asks for a credential under the parameter\'s rp id', () => {
    expect(optionsOf(input).publicKey.rp['id']).toBe(rpId);
    expect(optionsOf(method.enrollInput({ relyingPartyId: 'other.example', userName: 'alice' })).publicKey.rp['id']).toBe(
      'other.example',
    );
  });

  it('asks for ES256 alone, UV required, a resident key and attestation none', () => {
    const { publicKey } = optionsOf(input);

    expect(publicKey.pubKeyCredParams).toEqual([{ type: 'public-key', alg: -7 }]);
    expect(publicKey.authenticatorSelection.userVerification).toBe('required');
    expect(publicKey.authenticatorSelection.residentKey).toBe('required');
    expect(publicKey.attestation).toBe('none');
  });

  it('names the user the parameter names', () => {
    expect(optionsOf(input).publicKey.user.name).toBe('alice');
  });

  it('carries a challenge that depends on no digest: bytes, the same for every rp id and user', () => {
    const other = optionsOf(method.enrollInput({ relyingPartyId: 'other.example', userName: 'bob' }));

    expect(optionsOf(input).publicKey.challenge).toBeInstanceOf(Uint8Array);
    expect(optionsOf(input).publicKey.challenge.length).toBeGreaterThan(0);
    expect(other.publicKey.challenge).toEqual(optionsOf(input).publicKey.challenge);
  });

  it('refuses parameters that are not two non-empty strings by throwing, before any device is asked', () => {
    expect(() => method.enrollInput({ relyingPartyId: rpId })).toThrow();
    expect(() => method.enrollInput({ userName: 'alice' })).toThrow();
    expect(() => method.enrollInput({ relyingPartyId: '', userName: 'alice' })).toThrow();
    expect(() => method.enrollInput({ relyingPartyId: 7, userName: 'alice' })).toThrow();
  });
});

describe('configFrom', () => {
  const key = freshKey();
  const input = method.enrollInput({ relyingPartyId: rpId, userName: 'alice' });

  it('writes (x, y, sha256(rpId)) from a stand-in credential', async () => {
    expect(await method.configFrom(input, { credential: creation(key, rpId) })).toBe(configOfKey(key, rpId));
  });

  it('decodes through the codec to the credential\'s own point', async () => {
    const config = (await method.configFrom(input, { credential: creation(key, rpId) })) as Hex;

    expect(method.codec.decodeConfig(config)).toMatchObject({ x: key.x, y: key.y });
  });

  it('reads the key whatever the credential id length', async () => {
    for (const length of [1, 16, 64, 255, 1023]) {
      const credential = creation(key, rpId, { credentialId: new Uint8Array(length).fill(7) });

      expect(await method.configFrom(input, { credential })).toBe(configOfKey(key, rpId));
    }
  });

  it('a credential minted under another rp id is EnrollFailure', async () => {
    expectFailure(await method.configFrom(input, { credential: creation(key, 'other.example') }));
    expectFailure(await method.configFrom(input, { credential: creation(key, `login.${rpId}`) }));
  });

  it('a key that is not ES256 on P-256 is EnrollFailure', async () => {
    for (const overrides of [{ alg: -8 }, { alg: -257 }, { crv: 2 }, { kty: 1 }, { alg: -35 }]) {
      const credential = creation(key, rpId, { publicKey: coseKey(key, overrides) });

      expectFailure(await method.configFrom(input, { credential }));
    }
  });

  it('a point off the curve is EnrollFailure', async () => {
    expectFailure(await method.configFrom(input, { credential: creation({ x: key.x, y: key.y ^ 1n }, rpId) }));
  });

  it('authenticator data without attested credential data is EnrollFailure', async () => {
    expectFailure(await method.configFrom(input, { credential: creation(key, rpId, { flags: FLAG_UP | FLAG_UV }) }));
  });

  it('an EnrollInput that is not this method\'s ceremony is EnrollFailure', async () => {
    const credential = creation(key, rpId);

    expectFailure(await method.configFrom({ kind: 'nothing-to-perform' }, { credential }));
    expectFailure(await method.configFrom({ kind: 'ceremony' }, { credential }));
  });

  it('malformed material is a typed failure, never a throw', async () => {
    const good = creation(key, rpId);
    const materials: unknown[] = [
      undefined,
      {},
      { credential: null },
      { credential: 'not a credential' },
      { credential: { response: {} } },
      { credential: { ...good, response: { ...good.response, attestationObject: 'o2NmbXRkbm9uZQ' } } },
      { credential: { ...good, response: { ...good.response, attestationObject: bufferOf(Uint8Array.of(0xff, 0x00)) } } },
      { credential: { ...good, response: { ...good.response, attestationObject: bufferOf(cbor([['fmt', 'none']])) } } },
      {
        credential: {
          ...good,
          response: { ...good.response, attestationObject: bufferOf(cbor([['authData', new Uint8Array(40)]])) },
        },
      },
      {
        credential: {
          ...good,
          response: {
            ...good.response,
            attestationObject: bufferOf(cbor([['authData', bytesOf(`${'00'.repeat(32)}45${'00'.repeat(4 + 16)}ffff`)]])),
          },
        },
      },
    ];

    for (const material of materials) {
      const result = method.configFrom(input, material as Parameters<typeof method.configFrom>[1]);

      await expect(result).resolves.toMatchObject({ kind: 'reply-failure' });
    }
  });

  it('enrollment and assertion under one rp id verify end to end', async () => {
    const config = (await method.configFrom(input, { credential: creation(key, rpId) })) as Hex;
    const ctx = ctxFor(config);
    const parts = assertionParts(key, rpId, bytesOf(ctx.digest));
    const { r, s } = parseDer(parts.signature);

    expect(
      await method.verify(ctx, proofBytes(parts.authenticatorData, parts.clientDataJSON, r, s > HALF_N ? N - s : s)),
    ).toBe('satisfied');
  });
});

describe('configFrom, credentials browsers produce beyond the minimal shape', () => {
  const key = freshKey();
  const input = method.enrollInput({ relyingPartyId: rpId, userName: 'alice' });

  it('attestationObject handed as a Uint8Array view rather than an ArrayBuffer', async () => {
    const good = creation(key, rpId);
    const view = new Uint8Array(good.response.attestationObject);

    expect(await method.configFrom(input, { credential: { ...good, response: { ...good.response, attestationObject: view } } })).toBe(
      configOfKey(key, rpId),
    );
  });

  it('attested credential data followed by extension data (ED flag) still yields the key', async () => {
    const credential = creation(key, rpId, { extensions: cbor([['credProtect', 2]]) });

    expect(await method.configFrom(input, { credential })).toBe(configOfKey(key, rpId));
  });
});
