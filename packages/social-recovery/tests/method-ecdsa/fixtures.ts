import { hashTypedData, type TypedDataDefinition } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';
import type { Address, ApproverRequest, Ctx, Hex, TypedData } from '../../src/index';
import type { VectorRow } from '../kat/read-vector';

/** Private key 0x01, the public test key the proof vector signs with. */
export const KEY_ONE: Hex = `0x${'0'.repeat(63)}1`;

export const KEY_TWO: Hex = `0x${'0'.repeat(63)}2`;

export const SIGNER_ONE: Address = privateKeyToAccount(KEY_ONE).address;

export const SIGNER_TWO: Address = privateKeyToAccount(KEY_TWO).address;

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** The secp256k1 group order. */
export const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** `abi.encode(address)` written out by hand: twelve zero bytes, then the address. */
export const addressWord = (address: Address): Hex => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;

const MANAGER: Address = '0x00000000000000000000000000000000000000b1';

const ACCOUNT: Address = '0x00000000000000000000000000000000000000c1';

const ACTION: Address = '0x00000000000000000000000000000000000000d1';

const METHOD: Address = '0x00000000000000000000000000000000000000e1';

const TOKEN: Address = '0x00000000000000000000000000000000000000f1';

const SETUP_BODY_HASH: Hex = `0x${'ab'.repeat(32)}`;

const PAYLOAD: Hex = '0x1234';

const DOMAIN = { name: 'PolicyManager', version: '1', chainId: 11155111, verifyingContract: MANAGER } as const;

/** The approval message's typed-data types, with the nested payment order. */
const APPROVAL_TYPES = {
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
} as const;

const CANCELLATION_TYPES = {
  Cancellation: [
    { name: 'account', type: 'address' },
    { name: 'action', type: 'address' },
    { name: 'attemptId', type: 'uint64' },
    { name: 'setupNonce', type: 'uint64' },
    { name: 'setupBodyHash', type: 'bytes32' },
    { name: 'validUntil', type: 'uint48' },
    { name: 'place', type: 'uint256' },
  ],
} as const;

export type CtxOptions = {
  readonly guardian?: Address;
  /** Raw config bytes, overriding the guardian's address word. */
  readonly config?: Hex;
  readonly credentialHoldsCode?: boolean;
  readonly purpose?: 'approval' | 'cancellation';
  readonly place?: number;
  readonly attemptId?: bigint;
};

/** The typed data for one place, in the record's shape. */
export const typedDataFor = (options: CtxOptions = {}): TypedData => {
  const place = options.place ?? 2;
  const attemptId = options.attemptId ?? 7n;
  const common = {
    account: ACCOUNT,
    action: ACTION,
    attemptId,
    setupNonce: 3n,
    setupBodyHash: SETUP_BODY_HASH,
    validUntil: 1_900_000_000,
    place,
  };

  if (options.purpose === 'cancellation') {
    return { domain: DOMAIN, types: CANCELLATION_TYPES, primaryType: 'Cancellation', message: common };
  }

  return {
    domain: DOMAIN,
    types: APPROVAL_TYPES,
    primaryType: 'Approval',
    message: { ...common, payload: PAYLOAD, order: { token: TOKEN, amount: 5n, payee: ACCOUNT } },
  };
};

/** The digest viem derives from the typed data, what the orchestrator hands the implementation. */
export const digestOf = (typedData: TypedData): Hex => hashTypedData(typedData as unknown as TypedDataDefinition);

/** A ctx built by hand from the records, for one place. */
export const ctxFor = (options: CtxOptions = {}): Ctx => {
  const typedData = typedDataFor(options);
  const message = typedData.message;
  const members = {
    kind: 'recovery-proof-request',
    version: 1,
    chainId: String(DOMAIN.chainId),
    manager: MANAGER,
    digestVersion: DOMAIN.version,
    account: message.account,
    action: message.action,
    attemptId: String(message.attemptId),
    setupNonce: String(message.setupNonce),
    setupBodyHash: message.setupBodyHash,
    validUntil: String(message.validUntil),
    place: message.place,
    method: METHOD,
    config: options.config ?? addressWord(options.guardian ?? SIGNER_ONE),
    salt: `0x${'5a'.repeat(32)}`,
    credentialHoldsCode: options.credentialHoldsCode ?? false,
  } as const;
  const request: ApproverRequest =
    typedData.primaryType === 'Approval'
      ? { ...members, purpose: 'approval', payload: typedData.message.payload, order: { token: TOKEN, amount: '5', payee: ACCOUNT } }
      : { ...members, purpose: 'cancellation' };

  return { request, place: message.place, digest: digestOf(typedData), typedData };
};

/** A 65-byte r || s || v signature over a raw hash, v in {27, 28}. */
export const signDigest = (hash: Hex, privateKey: Hex = KEY_ONE): Promise<Hex> => sign({ hash, privateKey, to: 'hex' });

/** The same key's EIP-191 personal-message signature over the digest's bytes. */
export const signPersonal = (hash: Hex, privateKey: Hex = KEY_ONE): Promise<Hex> =>
  privateKeyToAccount(privateKey).signMessage({ message: { raw: hash } });

export type Parts = { readonly r: bigint; readonly s: bigint; readonly v: number };

export const splitSignature = (signature: Hex): Parts => ({
  r: BigInt(`0x${signature.slice(2, 66)}`),
  s: BigInt(`0x${signature.slice(66, 130)}`),
  v: Number.parseInt(signature.slice(130, 132), 16),
});

export const joinSignature = ({ r, s, v }: Parts): Hex =>
  `0x${r.toString(16).padStart(64, '0')}${s.toString(16).padStart(64, '0')}${v.toString(16).padStart(2, '0')}`;

/** The malleable twin of a low-s signature: s' = n - s and the other recovery byte. */
export const highSTwin = (signature: Hex, raw = false): Hex => {
  const { r, s, v } = splitSignature(signature);
  const flipped = v === 27 ? 28 : 27;

  return joinSignature({ r, s: CURVE_ORDER - s, v: raw ? flipped - 27 : flipped });
};

/** The same signature with its recovery byte as 0 or 1. */
export const rawRecovery = (signature: Hex): Hex => {
  const parts = splitSignature(signature);

  return joinSignature({ ...parts, v: parts.v - 27 });
};

export type SignedPlace = { readonly signature: Hex; readonly ctx: Ctx };

/** Signatures by key 0x01 over several places until one of each recovery byte, 27 and 28, is found. */
export const signaturesByParity = async (): Promise<{ readonly v27: SignedPlace; readonly v28: SignedPlace }> => {
  let v27: SignedPlace | undefined;
  let v28: SignedPlace | undefined;

  for (let attempt = 1n; attempt < 64n && (v27 === undefined || v28 === undefined); attempt++) {
    const ctx = ctxFor({ attemptId: attempt });
    const signature = await signDigest(ctx.digest);

    if (splitSignature(signature).v === 27) v27 ??= { signature, ctx };
    else v28 ??= { signature, ctx };
  }

  if (v27 === undefined || v28 === undefined) throw new Error('no signature of each parity found');

  return { v27, v28 };
};

/** A vector row's name, its `id` field. */
export const rowName = (row: VectorRow): string => String(row['id']);

/** A vector row's expected fields; none for a row that is not there. */
export const expectedOf = (row: VectorRow | undefined): Record<string, unknown> => (row?.expected ?? {}) as Record<string, unknown>;
