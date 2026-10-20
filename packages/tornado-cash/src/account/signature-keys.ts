import { Keystore } from '@kohaku-eth/plugins';
import { bytesToHex, bytesToNumberLE } from '@noble/curves/utils.js';
import { privateKeyToAccount } from 'viem/accounts';
import {
  concat,
  hexToBigInt,
  hexToBytes,
  keccak256,
  parseSignature,
  slice,
  stringToBytes,
  toBytes,
  type Hex,
  type TypedDataDomain,
} from 'viem';

import { Commitment, Nullifier, NullifierHash } from '../interfaces/types.interface';
import { pedersenHash } from '../utils/proof.util';
import { Secret, SecretManagerParams, SignatureDeriveParams } from './keys';

/** Signature-derived secrets for Tornado Cash. One deterministic EIP-712
 * signature per (nonce, chain). The domain binds the chain and not a pool;
 * each pool is mixed in afterwards:
 *
 *   σ         = sign(TornadoCashNote(nonce))  // domain.chainId = chain
 *   rs        = r(32) ‖ lowS(s)(32)           // big-endian, low-s, v dropped
 *   nullifier = trunc31(keccak256("nullifier" ‖ pool ‖ rs))
 *   secret    = trunc31(keccak256("secret"    ‖ pool ‖ rs))
 *
 * `rs` follows the Privacy Pools canonical-(r, s) layout so software and
 * hardware signers agree. The 31-byte digests are the Pedersen preimage
 * bytes (little-endian bigint in {@link Secret}).
 */

/** keccak256("tornado"), matching kohaku-rs `DOMAIN_SALT`. */
export const TORNADO_DOMAIN_SALT = keccak256(stringToBytes('tornado'));

const SIGNATURE_SCHEME_PATH = "m/29795'/1'";

const NOTE_TYPES = {
  TornadoCashNote: [
    { name: 'nonce', type: 'uint64' },
  ],
} as const;

export interface NoteEnvelope {
  domain: TypedDataDomain;
  types: typeof NOTE_TYPES;
  primaryType: 'TornadoCashNote';
  message: { nonce: bigint };
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_N = SECP256K1_N / 2n;

function canonicalRS(sig: Hex): Uint8Array {
  const { r, s } = parseSignature(sig);
  const sValue = hexToBigInt(s);
  const sLow = sValue > SECP256K1_HALF_N ? SECP256K1_N - sValue : sValue;

  return concat([toBytes(r, { size: 32 }), toBytes(sLow, { size: 32 })]);
}

/** First 31 bytes of `keccak256(tag ‖ pool_be_20 ‖ rs)`. Chain id is in the domain. */
function trunc31(tag: string, poolAddress: bigint, sig: Hex): Uint8Array {
  const digest = keccak256(concat([
    stringToBytes(tag),
    toBytes(poolAddress, { size: 20 }),
    canonicalRS(sig),
  ]));

  return hexToBytes(slice(digest, 0, 31));
}

export interface EnvelopeSigner {
  signEnvelope(envelope: NoteEnvelope): Promise<Hex>;
}

function buildNoteEnvelope(nonce: number, chainId: bigint): NoteEnvelope {
  return {
    domain: {
      name: 'TornadoCash Keychain',
      version: '1',
      chainId,
      salt: TORNADO_DOMAIN_SALT,
    },
    types: NOTE_TYPES,
    primaryType: 'TornadoCashNote',
    message: { nonce: BigInt(nonce) },
  };
}

export class KeystoreEnvelopeSigner implements EnvelopeSigner {
  constructor(
    private readonly keystore: Keystore,
    private readonly accountIndex: number,
  ) {}

  async signEnvelope(envelope: NoteEnvelope): Promise<Hex> {
    const key = await this.keystore.deriveAt(`${SIGNATURE_SCHEME_PATH}/${this.accountIndex}'`);

    return privateKeyToAccount(key).signTypedData(envelope);
  }
}

export interface SignatureSecretManagerParams extends SecretManagerParams {
  signer?: EnvelopeSigner;
}

export interface SignatureSecretSource {
  getSignatureSecrets: (params: SignatureDeriveParams) => Promise<Secret>;
  deriveSignatureEphemeralSigner: (params: SignatureDeriveParams) => Promise<`0x${string}`>;
}

export async function SignatureSecretManager({
  host,
  accountIndex = 0,
  signer,
}: SignatureSecretManagerParams): Promise<SignatureSecretSource> {
  const envelopeSigner = signer ?? new KeystoreEnvelopeSigner(host.keystore, accountIndex);
  const sigCache = new Map<string, Promise<Hex>>();

  const signNonce = (nonce: number, chainId: bigint): Promise<Hex> => {
    const key = `${chainId}:${nonce}`;
    const hit = sigCache.get(key);

    if (hit) return hit;

    const pending = envelopeSigner.signEnvelope(buildNoteEnvelope(nonce, chainId)).catch((err) => {
      sigCache.delete(key);
      throw err;
    });

    sigCache.set(key, pending);

    return pending;
  };

  const getSignatureSecrets = async ({ nonce, chainId, poolAddress }: SignatureDeriveParams): Promise<Secret> => {
    const sig = await signNonce(nonce, chainId);
    const nullifierBytes = trunc31('nullifier', poolAddress, sig);
    const secretBytes = trunc31('secret', poolAddress, sig);
    const preimage = new Uint8Array(62);

    preimage.set(nullifierBytes, 0);
    preimage.set(secretBytes, 31);

    return {
      nullifier: bytesToNumberLE(nullifierBytes) as Nullifier,
      salt: bytesToNumberLE(secretBytes),
      commitment: pedersenHash(preimage) as Commitment,
      nullifierHash: pedersenHash(nullifierBytes) as NullifierHash,
    };
  };

  const deriveSignatureEphemeralSigner = async ({ nonce, chainId, poolAddress }: SignatureDeriveParams) => {
    const sig = await signNonce(nonce, chainId);
    const key = trunc31('signer', poolAddress, sig);

    return `0x00${bytesToHex(key)}` as `0x${string}`;
  };

  return { getSignatureSecrets, deriveSignatureEphemeralSigner };
}
