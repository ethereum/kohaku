import {
  METHOD_AADHAAR_DIGEST_ERROR,
  METHOD_AADHAAR_G1_PROJECTIVE,
  METHOD_AADHAAR_G2_PROJECTIVE,
  METHOD_AADHAAR_GROTH16_CURVE,
  METHOD_AADHAAR_GROTH16_PROTOCOL,
  METHOD_AADHAAR_PUBLIC_INPUTS,
} from '../constants/method-aadhaar';
import type { Hex, Verdict } from '../interfaces';
import type { AadhaarConfig, AadhaarPcd, AadhaarProof, AadhaarStackProof, AnonAadhaarStack } from '../types';
import { decodeConfig, decodeProof } from './codec';
import { isDigest, signalHashFromDigest } from './signal';
import { inputAt } from './words';

/** Whether the public inputs carry the config's nullifier and seed and the digest's signal hash. */
export function bindsTo(proof: AadhaarProof, config: AadhaarConfig, digest: Hex): boolean {
  return (
    inputAt(proof.inputs, 'nullifier') === config.nullifier &&
    inputAt(proof.inputs, 'nullifierSeed') === config.nullifierSeed &&
    inputAt(proof.inputs, 'signalHash') === signalHashFromDigest(digest)
  );
}

/** The proof layout back as the stack's proof object, undoing `packProof`. */
export function toPcd(proof: AadhaarProof): AadhaarPcd {
  const [b0, b1] = proof.b;
  const signals = Object.fromEntries(
    METHOD_AADHAAR_PUBLIC_INPUTS.map((name) => [name, (inputAt(proof.inputs, name) ?? 0n).toString()]),
  ) as Omit<AadhaarStackProof, 'groth16Proof'>;
  const groth16Proof = {
    pi_a: [proof.a[0].toString(), proof.a[1].toString(), METHOD_AADHAAR_G1_PROJECTIVE],
    pi_b: [
      [b0[1].toString(), b0[0].toString()],
      [b1[1].toString(), b1[0].toString()],
      [...METHOD_AADHAAR_G2_PROJECTIVE],
    ],
    pi_c: [proof.c[0].toString(), proof.c[1].toString(), METHOD_AADHAAR_G1_PROJECTIVE],
    protocol: METHOD_AADHAAR_GROTH16_PROTOCOL,
    curve: METHOD_AADHAAR_GROTH16_CURVE,
  };

  return { proof: { ...signals, groth16Proof } };
}

/**
 * The local verdict, read off no chain: `rejected` for bytes that do not decode or
 * bindings that fail, else the stack's answer, or `not-judged` when the stack throws.
 */
export async function judge(stack: AnonAadhaarStack, config: Hex, digest: Hex, proof: Hex): Promise<Verdict> {
  if (!isDigest(digest)) throw new TypeError(METHOD_AADHAAR_DIGEST_ERROR);

  let decoded: AadhaarProof;

  try {
    decoded = decodeProof(proof);

    if (!bindsTo(decoded, decodeConfig(config), digest)) return 'rejected';
  } catch {
    return 'rejected';
  }

  try {
    return (await stack.verify(toPcd(decoded))) === true ? 'satisfied' : 'rejected';
  } catch {
    return 'not-judged';
  }
}
