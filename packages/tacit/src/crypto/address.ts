import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bech32mDecode, bech32mEncode } from "./bech32m";
import { concatBytes, toBig, utf8 } from "./bytes";
import { isIdentity, mulB8, packPoint, type Point, unpackPoint } from "./field";
import { walletKeys, type WalletKeys } from "./keys";

export type SecpPoint = InstanceType<typeof secp256k1.Point>;

const SECP_ORDER = secp256k1.Point.Fn.ORDER;
const NETWORK = "mainnet";
const SEED_TAG = utf8("tacit-btc-pool-seed-v1");
const VIEW_TAG = utf8("tacit-btc-pool-wallet-view-v1");

/** Mainnet pool addresses: bech32m over `V (33) ‖ A (32) ‖ N (32)` with this prefix. */
export const ADDRESS_HRP = "bp";
export const ADDRESS_LEN = 97;

/** What a sender needs to pay an address: the view key `V` and the BabyJubJub points `A` and `N`. */
export type Recipient = { V: SecpPoint; A: Point; N: Point };

/** A wallet: its scalars, its public address, and the keys derived from them. */
export type PoolKeys = Recipient & { v: bigint; zk: WalletKeys; address: string };

export function addressString(recipient: Recipient): string {
  const bytes = concatBytes(recipient.V.toBytes(true), packPoint(recipient.A), packPoint(recipient.N));

  return bech32mEncode(ADDRESS_HRP, bytes);
}

/** Keys from a 32-byte identity key, the way every Tacit app derives them from one secret. */
export function keysFromIdentity(identityKey: Uint8Array): PoolKeys {
  if (identityKey.length !== 32) throw new Error("tacit: identity key must be 32 bytes");

  const seed = hmac(sha256, identityKey, SEED_TAG);
  const v = toBig(keccak_256(concatBytes(VIEW_TAG, utf8(NETWORK), seed))) % SECP_ORDER;

  if (v === 0n) throw new Error("tacit: view scalar reduced to zero");

  const zk = walletKeys(seed, NETWORK);
  const recipient = { V: secp256k1.Point.BASE.multiply(v), A: mulB8(zk.a), N: mulB8(zk.n) };

  return { ...recipient, v, zk, address: addressString(recipient) };
}

export function decodeAddress(text: string): Recipient {
  const { hrp, bytes } = bech32mDecode(text.trim());

  if (hrp !== ADDRESS_HRP) throw new Error(`tacit: unknown address prefix ${hrp}`);

  if (bytes.length !== ADDRESS_LEN) throw new Error("tacit: address must be 97 bytes");

  const A = unpackPoint(bytes.subarray(33, 65));
  const N = unpackPoint(bytes.subarray(65, 97));

  if (!A || !N || isIdentity(A) || isIdentity(N)) throw new Error("tacit: not a BabyJubJub subgroup point");

  return { V: secp256k1.Point.fromBytes(bytes.subarray(0, 33)), A, N };
}
