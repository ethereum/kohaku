import { pedersenHash as millerPedersenHash, Point } from "micro-zk-proofs/pedersen.js";

export function pedersenHash(msg: Uint8Array): bigint {
  const hash = millerPedersenHash(msg);  // encoded baby jubjub point

  return Point.decode(hash).x;
}
