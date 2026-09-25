import { createECDH, createHash, createPrivateKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { encodeAbiParameters, hashTypedData } from 'viem';
import type { Ctx, Hex, TypedData } from '../../src/interfaces';

/** The order of the P-256 group (SEC 2 §2.4.2). */
export const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** Half the group order, rounded down: the largest low s. */
export const HALF_N = N >> 1n;

export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;
export const FLAG_AT = 0x40;
export const FLAG_ED = 0x80;

export const hexOf = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`;

export const bytesOf = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex.replace(/^0x/, ''), 'hex'));

export const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
};

/** A fresh `ArrayBuffer` holding exactly these bytes, as a browser returns it. */
export const bufferOf = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.length);

  new Uint8Array(buffer).set(bytes);

  return buffer;
};

export const sha256 = (bytes: Uint8Array | string): Uint8Array =>
  new Uint8Array(createHash('sha256').update(bytes).digest());

export const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

export const word = (value: bigint): Uint8Array => bytesOf(value.toString(16).padStart(64, '0'));

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export type Key = { readonly privateKey: KeyObject; readonly x: bigint; readonly y: bigint };

const keyOfJwk = (privateKey: KeyObject): Key => {
  const jwk = privateKey.export({ format: 'jwk' });

  return {
    privateKey,
    x: BigInt(hexOf(new Uint8Array(Buffer.from(jwk.x ?? '', 'base64url')))),
    y: BigInt(hexOf(new Uint8Array(Buffer.from(jwk.y ?? '', 'base64url')))),
  };
};

/** A random P-256 key. */
export const freshKey = (): Key => keyOfJwk(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey);

/** The P-256 key for a scalar in [1, n-1], deterministic, for property tests. */
export const keyOfScalar = (scalar: bigint): Key => {
  const d = word(scalar);
  const ecdh = createECDH('prime256v1');

  ecdh.setPrivateKey(d);

  const point = ecdh.getPublicKey();
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: base64url(d),
    x: base64url(point.subarray(1, 33)),
    y: base64url(point.subarray(33, 65)),
  };

  return keyOfJwk(createPrivateKey({ key: jwk, format: 'jwk' }));
};

const derInteger = (value: bigint): Uint8Array => {
  let bytes = bytesOf(value.toString(16).padStart(2 * Math.ceil(value.toString(16).length / 2), '0'));

  while (bytes.length > 1 && bytes[0] === 0 && ((bytes[1] ?? 0) & 0x80) === 0) bytes = bytes.subarray(1);

  if (((bytes[0] ?? 0) & 0x80) !== 0) bytes = concat(Uint8Array.of(0), bytes);

  return concat(Uint8Array.of(0x02, bytes.length), bytes);
};

export const derOf = (r: bigint, s: bigint): Uint8Array => {
  const body = concat(derInteger(r), derInteger(s));

  return concat(Uint8Array.of(0x30, body.length), body);
};

/** Splits a short-form DER ECDSA signature into r and s, keeping r's encoded length. */
export const parseDer = (der: Uint8Array): { r: bigint; s: bigint; rLength: number } => {
  const rLength = der[3] ?? 0;
  const r = BigInt(hexOf(der.subarray(4, 4 + rLength)));
  const sLength = der[5 + rLength] ?? 0;
  const s = BigInt(hexOf(der.subarray(6 + rLength, 6 + rLength + sLength)));

  return { r, s, rLength };
};

/** The DER signature `node:crypto` produces over sha256(message). */
export const signDer = (key: Key, message: Uint8Array): Uint8Array =>
  new Uint8Array(sign('sha256', message, { key: key.privateKey, dsaEncoding: 'der' }));

const cborHead = (major: number, value: number): Uint8Array => {
  const tag = major << 5;

  if (value < 24) return Uint8Array.of(tag | value);

  if (value < 0x100) return Uint8Array.of(tag | 24, value);

  if (value < 0x10000) return Uint8Array.of(tag | 25, value >> 8, value & 0xff);

  return Uint8Array.of(tag | 26, (value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
};

export type Cbor = number | string | Uint8Array | readonly (readonly [Cbor, Cbor])[];

/** A minimal CBOR encoder, written by hand so the tests share no parsing with the implementation. */
export const cbor = (value: Cbor): Uint8Array => {
  if (typeof value === 'number') return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);

  if (typeof value === 'string') return concat(cborHead(3, utf8(value).length), utf8(value));

  if (value instanceof Uint8Array) return concat(cborHead(2, value.length), value);

  return concat(cborHead(5, value.length), ...value.flatMap(([k, v]) => [cbor(k), cbor(v)]));
};

/** The COSE_Key a browser writes for an ES256 credential, in CTAP2 canonical order. */
export const coseKey = (key: { x: bigint; y: bigint }, overrides: { kty?: number; alg?: number; crv?: number } = {}) =>
  cbor([
    [1, overrides.kty ?? 2],
    [3, overrides.alg ?? -7],
    [-1, overrides.crv ?? 1],
    [-2, word(key.x)],
    [-3, word(key.y)],
  ]);

export const authenticatorData = (
  relyingPartyId: string,
  flags: number,
  counter = 0,
  attested?: { credentialId: Uint8Array; publicKey: Uint8Array },
  extensions?: Uint8Array,
): Uint8Array => {
  const head = concat(sha256(relyingPartyId), Uint8Array.of(flags), word(BigInt(counter)).subarray(28));

  if (attested === undefined) return extensions === undefined ? head : concat(head, extensions);

  const idLength = Uint8Array.of(attested.credentialId.length >> 8, attested.credentialId.length & 0xff);
  const aaguid = new Uint8Array(16);

  return concat(head, aaguid, idLength, attested.credentialId, attested.publicKey, extensions ?? new Uint8Array());
};

export const clientDataJSON = (
  challenge: Uint8Array,
  options: { type?: string; origin?: string; extra?: Record<string, unknown> } = {},
): string =>
  JSON.stringify({
    type: options.type ?? 'webauthn.get',
    challenge: base64url(challenge),
    origin: options.origin ?? 'https://recover.example',
    crossOrigin: false,
    ...options.extra,
  });

export const credentialIdOf = (seed: number): Uint8Array => sha256(`credential-${seed}`).subarray(0, 16);

/** What `navigator.credentials.create` returns for an ES256 passkey, attestation `none`. */
export const creation = (
  key: { x: bigint; y: bigint },
  relyingPartyId: string,
  options: { publicKey?: Uint8Array; flags?: number; extensions?: Uint8Array; credentialId?: Uint8Array } = {},
) => {
  const credentialId = options.credentialId ?? credentialIdOf(1);
  const authData = authenticatorData(
    relyingPartyId,
    options.flags ?? FLAG_UP | FLAG_UV | FLAG_AT | (options.extensions === undefined ? 0 : FLAG_ED),
    0,
    { credentialId, publicKey: options.publicKey ?? coseKey(key) },
    options.extensions,
  );
  const attestationObject = cbor([
    ['fmt', 'none'],
    ['attStmt', []],
    ['authData', authData],
  ]);

  return {
    'id': base64url(credentialId),
    rawId: bufferOf(credentialId),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: bufferOf(utf8(clientDataJSON(new Uint8Array(16), { type: 'webauthn.create' }))),
      attestationObject: bufferOf(attestationObject),
    },
  };
};

export type AssertionParts = {
  readonly authenticatorData: Uint8Array;
  readonly clientDataJSON: string;
  readonly signature: Uint8Array;
};

/** Signs `authenticatorData || sha256(clientDataJSON)` the way an authenticator does. */
export const signAssertion = (key: Key, authData: Uint8Array, clientData: string): Uint8Array =>
  signDer(key, concat(authData, sha256(clientData)));

/** The parts of one assertion over a challenge; `pick` retries signing until the DER satisfies it. */
export const assertionParts = (
  key: Key,
  relyingPartyId: string,
  challenge: Uint8Array,
  options: {
    flags?: number;
    type?: string;
    extra?: Record<string, unknown>;
    pick?: (der: Uint8Array) => boolean;
  } = {},
): AssertionParts => {
  const clientData = clientDataJSON(challenge, { ...(options.type === undefined ? {} : { type: options.type }), ...(options.extra === undefined ? {} : { extra: options.extra }) });

  for (let counter = 1; counter < 1_000_000; counter += 1) {
    const authData = authenticatorData(relyingPartyId, options.flags ?? FLAG_UP | FLAG_UV, counter);
    const signature = signAssertion(key, authData, clientData);

    if (options.pick === undefined || options.pick(signature)) {
      return { authenticatorData: authData, clientDataJSON: clientData, signature };
    }
  }

  throw new Error('no signature matched the pick');
};

/** What `navigator.credentials.get` returns. */
export const assertionRecord = (parts: AssertionParts, credentialId = credentialIdOf(1)) => ({
  'id': base64url(credentialId),
  rawId: bufferOf(credentialId),
  type: 'public-key',
  authenticatorAttachment: 'platform',
  response: {
    authenticatorData: bufferOf(parts.authenticatorData),
    clientDataJSON: bufferOf(utf8(parts.clientDataJSON)),
    signature: bufferOf(parts.signature),
    userHandle: null,
  },
});

/** The config layout written out by hand, independent of the codec. */
export const configBytes = (x: bigint, y: bigint, rpIdHash: Hex): Hex =>
  encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }], [x, y, rpIdHash]);

/** The proof layout written out by hand, independent of the codec. */
export const proofBytes = (authData: Uint8Array | Hex, clientData: string, r: bigint, s: bigint): Hex =>
  encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes' }, { type: 'uint256' }, { type: 'uint256' }],
    [typeof authData === 'string' ? authData : hexOf(authData), hexOf(utf8(clientData)), r, s],
  );

export const configOfKey = (key: { x: bigint; y: bigint }, relyingPartyId: string): Hex =>
  configBytes(key.x, key.y, hexOf(sha256(relyingPartyId)));

const ADDRESS = {
  manager: '0x1111111111111111111111111111111111111111',
  account: '0x2222222222222222222222222222222222222222',
  action: '0x3333333333333333333333333333333333333333',
  method: '0x4444444444444444444444444444444444444444',
  token: '0x0000000000000000000000000000000000000000',
  payee: '0x5555555555555555555555555555555555555555',
} as const;

/** A request for one passkey place, with its digest from viem's `hashTypedData`. */
export const ctxFor = (config: Hex, options: { attemptId?: bigint; place?: number; digest?: Hex } = {}): Ctx => {
  const attemptId = options.attemptId ?? 7n;
  const place = options.place ?? 1;
  const typedData: TypedData = {
    domain: { name: 'PolicyManager', version: '1', chainId: 11155111, verifyingContract: ADDRESS.manager },
    types: {
      Approval: [
        { name: 'account', type: 'address' },
        { name: 'action', type: 'address' },
        { name: 'attemptId', type: 'uint64' },
        { name: 'setupNonce', type: 'uint64' },
        { name: 'setupBodyHash', type: 'bytes32' },
        { name: 'payload', type: 'bytes' },
        { name: 'order', type: 'PaymentOrder' },
        { name: 'validUntil', type: 'uint48' },
        { name: 'place', type: 'uint256' },
      ],
      PaymentOrder: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'payee', type: 'address' },
      ],
    },
    primaryType: 'Approval',
    message: {
      account: ADDRESS.account,
      action: ADDRESS.action,
      attemptId,
      setupNonce: 3n,
      setupBodyHash: `0x${'ab'.repeat(32)}`,
      payload: '0x1234',
      order: { token: ADDRESS.token, amount: 0n, payee: ADDRESS.payee },
      validUntil: 1_900_000_000,
      place,
    },
  };
  const digest =
    options.digest ?? hashTypedData(typedData as unknown as Parameters<typeof hashTypedData>[0]);

  return {
    request: {
      kind: 'recovery-proof-request',
      version: 1,
      chainId: '11155111',
      manager: ADDRESS.manager,
      digestVersion: '1',
      account: ADDRESS.account,
      action: ADDRESS.action,
      attemptId: attemptId.toString(),
      setupNonce: '3',
      setupBodyHash: `0x${'ab'.repeat(32)}`,
      validUntil: '1900000000',
      place,
      method: ADDRESS.method,
      config,
      salt: `0x${'cd'.repeat(32)}`,
      credentialHoldsCode: false,
      purpose: 'approval',
      payload: '0x1234',
      order: { token: ADDRESS.token, amount: '0', payee: ADDRESS.payee },
    },
    place,
    digest,
    typedData,
  };
};

/** The row shape of the config vector file. */
export type ConfigVectorFile = {
  readonly vectors: readonly {
    readonly 'id': string;
    readonly input: { readonly x: string; readonly y: string; readonly rpId: string; readonly rpIdHash: Hex };
    readonly expected: { readonly encoded: Hex };
  }[];
};

/** The row shape of the proof vector file. */
export type ProofVectorFile = {
  readonly vectors: readonly {
    readonly 'id': string;
    readonly input: {
      readonly digest: Hex;
      readonly authenticatorData: Hex;
      readonly clientDataJSON: string;
      readonly r: Hex;
      readonly s: Hex;
    };
    readonly expected: {
      readonly encoded: Hex;
      readonly signedHash: Hex;
      readonly verification: boolean;
      readonly challengeBase64url?: string;
      readonly reason?: string;
    };
  }[];
};

export const CONFIG_FILE = 'method-passkey-config.json';
export const PROOF_FILE = 'method-passkey-proof.json';
