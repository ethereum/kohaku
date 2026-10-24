import { sha256 } from "@noble/hashes/sha2.js";
import { be, concatBytes, toBig, utf8 } from "./bytes";
import { addPoint, mulB8, type Point } from "./field";
import { L_BJJ, P_FR, VALUE_LIMIT } from "./params";
import { poseidon } from "./poseidon";

const TAG = {
  spend: "tacit-btc-pool-zk-wallet-spend-v1",
  nk: "tacit-btc-pool-zk-wallet-nk-v1",
  authTweak: "tacit-btc-pool-zk-auth-tweak-v1",
  nkTweak: "tacit-btc-pool-zk-nk-tweak-v1",
  rho: "tacit-btc-pool-zk-rho-v1",
  nonce: "tacit-btc-pool-zk-eddsa-nonce-v1",
};

/** The wallet's BabyJubJub keys: spend scalar `a` and nullifier scalar `n` with their public points. */
export type WalletKeys = { a: bigint; n: bigint; A: Point; N: Point };

/** The keys of one note, derived from the wallet keys and the note's shared secret. */
export type NoteKeys = { sk: bigint; nk: bigint; npk: bigint; rho: bigint };

// hs(tag, parts): two SHA-256 blocks over tag ‖ parts ‖ 0x00 and 0x01, read as one 512-bit integer.
function wide(tag: string, parts: Uint8Array[]): bigint {
  const message = concatBytes(utf8(tag), ...parts);

  return toBig(concatBytes(sha256(concatBytes(message, Uint8Array.of(0))), sha256(concatBytes(message, Uint8Array.of(1)))));
}

function scalar(tag: string, parts: Uint8Array[]): bigint {
  const x = wide(tag, parts) % L_BJJ;

  if (x === 0n) throw new Error("tacit: zero scalar");

  return x;
}

export function walletKeys(seed: Uint8Array, network = "mainnet"): WalletKeys {
  if (seed.length !== 32) throw new Error("tacit: seed must be 32 bytes");

  const a = scalar(TAG.spend, [utf8(network), seed]);
  const n = scalar(TAG.nk, [utf8(network), seed]);

  return { a, n, A: mulB8(a), N: mulB8(n) };
}

function tweaks(secret: Uint8Array) {
  if (secret.length !== 33) throw new Error("tacit: shared secret must be 33 bytes");

  return {
    tA: scalar(TAG.authTweak, [secret]),
    tN: scalar(TAG.nkTweak, [secret]),
    rho: wide(TAG.rho, [secret]) % P_FR,
  };
}

export const npkOf = (ak: Point, nk: Point): bigint => poseidon([ak[0], ak[1], nk[0], nk[1]]);

/** Sender side: the recipient's note key and `rho` from its address points and the shared secret. */
export function outputKeys(A: Point, N: Point, secret: Uint8Array): { npk: bigint; rho: bigint } {
  const { tA, tN, rho } = tweaks(secret);

  return { npk: npkOf(addPoint(A, mulB8(tA)), addPoint(N, mulB8(tN))), rho };
}

/** Recipient side: the spend and nullifier scalars of the note that `secret` opens. */
export function ownedKeys(wallet: WalletKeys, secret: Uint8Array): NoteKeys {
  const { tA, tN, rho } = tweaks(secret);
  const sk = (wallet.a + tA) % L_BJJ;
  const nk = (wallet.n + tN) % L_BJJ;

  if (sk === 0n || nk === 0n) throw new Error("tacit: degenerate note key");

  return { sk, nk, npk: npkOf(mulB8(sk), mulB8(nk)), rho };
}

export function checkValue(value: bigint | number, name = "value"): bigint {
  const x = BigInt(value);

  if (x < 0n || x >= VALUE_LIMIT) throw new Error(`tacit: ${name} must be below 2^120`);

  return x;
}

export const leafOf = (asset: bigint, value: bigint, npk: bigint, rho: bigint): bigint =>
  poseidon([asset, checkValue(value), npk, rho]);

export function nullifierOf(nk: bigint, leaf: bigint, index: number | bigint): bigint {
  const i = BigInt(index);

  if (nk < 0n || nk >= L_BJJ) throw new Error("tacit: note nullifier key out of range");

  if (i < 0n || i >= 1n << 32n) throw new Error("tacit: leaf index out of range");

  return poseidon([nk, leaf, i]);
}

export type Signature = { R8: Point; S: bigint };

/** EdDSA-Poseidon over BabyJubJub, as circomlib verifies it. */
export function sign(sk: bigint, message: bigint): Signature {
  const k = sk % L_BJJ;
  const A = mulB8(k);
  const r = scalar(TAG.nonce, [be(k, 32), be(message, 32)]);
  const R8 = mulB8(r);
  const h = poseidon([R8[0], R8[1], A[0], A[1], message]);

  return { R8, S: (r + 8n * h * k) % L_BJJ };
}
