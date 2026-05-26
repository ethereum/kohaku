import type { Keystore } from "@kohaku-eth/plugins";
import { poseidon1, poseidon2 } from "poseidon-lite";

const TACIT_COIN_TYPE = 28785;

const BN254_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function deriveDepositSecrets(
  keystore: Keystore,
  chainId: bigint,
  depositIndex: number
): { secret: bigint; nullifierPreimage: bigint } {
  const chainSegment = Number(chainId) & 0x7fffffff;
  const secretHex = keystore.deriveAt(
    `m/${TACIT_COIN_TYPE}'/${chainSegment}'/${depositIndex}'/0'`
  );
  const nullifierHex = keystore.deriveAt(
    `m/${TACIT_COIN_TYPE}'/${chainSegment}'/${depositIndex}'/1'`
  );
  return {
    secret: BigInt(secretHex) % BN254_FIELD,
    nullifierPreimage: BigInt(nullifierHex) % BN254_FIELD,
  };
}

export function computeNullifierHash(nullifierPreimage: bigint): bigint {
  return poseidon1([nullifierPreimage]);
}

export function computeRLeaf(
  secret: bigint,
  nullifierPreimage: bigint
): bigint {
  return poseidon2([secret, nullifierPreimage]);
}

export function deriveAccountId(
  keystore: Keystore,
  chainId: bigint
): `tacit:${string}` {
  const rootHex = keystore.deriveAt(
    `m/${TACIT_COIN_TYPE}'/${Number(chainId) & 0x7fffffff}'/0'`
  );
  const short = rootHex.slice(0, 18);
  return `tacit:${short}`;
}
