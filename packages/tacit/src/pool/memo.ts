import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { type Recipient, type PoolKeys } from "../crypto/address";
import { be, bytesEqual, concatBytes, toBig, utf8 } from "../crypto/bytes";
import { leafOf, outputKeys, ownedKeys } from "../crypto/keys";
import { VALUE_LIMIT } from "../crypto/params";

/** One memo per output note: the ephemeral key (33), the sealed value (16) and a tag (16). */
export const MEMO_LEN = 65;

const TAG_AEAD = utf8("tacit-evm-pool-aead-v1");
const TAG_MAC = utf8("tacit-evm-pool-aead-tag-v1");
const SECP = secp256k1.Point;

export type SealedNote = { value: bigint; npk: bigint; rho: bigint; leaf: bigint; memo: Uint8Array };

/** What opening a memo yields: the note's value, its `rho`, and the shared secret that derives its keys. */
export type OpenedNote = { value: bigint; rho: bigint; secret: Uint8Array };

export function randomScalar(): bigint {
  for (;;) {
    const e = toBig(randomBytes(32)) % SECP.Fn.ORDER;

    if (e !== 0n) return e;
  }
}

function sealValue(secret: Uint8Array, value: bigint): Uint8Array {
  const key = keccak_256(concatBytes(TAG_AEAD, secret));
  const stream = keccak_256(concatBytes(key, new Uint8Array(2))).subarray(0, 16);
  const ct = be(value, 16).map((byte, i) => byte ^ stream[i]!);

  return concatBytes(ct, keccak_256(concatBytes(TAG_MAC, key, ct)).subarray(0, 16));
}

function openValue(secret: Uint8Array, sealed: Uint8Array): bigint | null {
  const key = keccak_256(concatBytes(TAG_AEAD, secret));
  const ct = sealed.subarray(0, 16);

  if (!bytesEqual(sealed.subarray(16, 32), keccak_256(concatBytes(TAG_MAC, key, ct)).subarray(0, 16))) return null;

  const stream = keccak_256(concatBytes(key, new Uint8Array(2))).subarray(0, 16);

  return toBig(ct.map((byte, i) => byte ^ stream[i]!));
}

/** An output note of `value` for `to`: its keys, leaf, and the memo that lets the recipient find it. */
export function sealNote(to: Recipient, value: bigint, asset: bigint, ephemeral: bigint = randomScalar()): SealedNote {
  if (value < 0n || value >= VALUE_LIMIT) throw new Error("tacit: value must be below 2^120");

  const secret = to.V.multiply(ephemeral).toBytes(true);
  const { npk, rho } = outputKeys(to.A, to.N, secret);

  return {
    value,
    npk,
    rho,
    leaf: leafOf(asset, value, npk, rho),
    memo: concatBytes(SECP.BASE.multiply(ephemeral).toBytes(true), sealValue(secret, value)),
  };
}

/**
 * The shared secret and value if `memo` is addressed to `keys` and recomputes `leaf`; null otherwise. Anything that
 * is not a note of this wallet, malformed or not, comes back null.
 */
export function openNote(keys: PoolKeys, item: { memo: Uint8Array; leaf: bigint; asset: bigint }): OpenedNote | null {
  if (item.memo.length !== MEMO_LEN) return null;

  let secret: Uint8Array;

  try {
    secret = SECP.fromBytes(item.memo.subarray(0, 33)).multiply(keys.v).toBytes(true);
  } catch {
    return null;
  }

  const value = openValue(secret, item.memo.subarray(33));

  if (value === null || value >= VALUE_LIMIT) return null;

  const owned = ownedKeys(keys.zk, secret);

  return leafOf(item.asset, value, owned.npk, owned.rho) === item.leaf ? { value, rho: owned.rho, secret } : null;
}
