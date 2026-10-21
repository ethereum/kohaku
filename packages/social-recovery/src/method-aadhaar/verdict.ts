import {
  METHOD_AADHAAR_DIGEST_NAME,
  METHOD_AADHAAR_DISCLOSURE_INPUTS,
  METHOD_AADHAAR_G1_PROJECTIVE,
  METHOD_AADHAAR_G2_PROJECTIVE,
  METHOD_AADHAAR_GROTH16_CURVE,
  METHOD_AADHAAR_GROTH16_PROTOCOL,
  METHOD_AADHAAR_MILLISECONDS_PER_SECOND,
  METHOD_AADHAAR_MIN_FRESHNESS_WINDOW,
  METHOD_AADHAAR_PUBLIC_INPUTS,
} from '../constants/method-aadhaar';
import { assertBytes32 } from '../formats/guards';
import type { Hex, Verdict } from '../interfaces';
import type { AadhaarConfig, AadhaarPcd, AadhaarProof, AadhaarStackProof, AnonAadhaarStack } from '../types/method-aadhaar';
import { decodeConfig, decodeProof } from './codec';
import { signalHashFromDigest } from './signal';
import { inputAt } from './words';

/**
 * Whether the public inputs carry the config's nullifier and seed and the digest's signal hash and disclose no field,
 * under a config whose freshness window is at least the minimum.
 */
export function bindsTo(proof: AadhaarProof, config: AadhaarConfig, digest: Hex): boolean {
  return (
    config.freshnessWindow >= METHOD_AADHAAR_MIN_FRESHNESS_WINDOW &&
    inputAt(proof.inputs, 'nullifier') === config.nullifier &&
    inputAt(proof.inputs, 'nullifierSeed') === config.nullifierSeed &&
    METHOD_AADHAAR_DISCLOSURE_INPUTS.every((name) => inputAt(proof.inputs, name) === 0n) &&
    inputAt(proof.inputs, 'signalHash') === signalHashFromDigest(digest)
  );
}

/** The system clock in whole seconds since the epoch. */
export function nowInSeconds(): bigint {
  const seconds = Math.floor(Date.now() / METHOD_AADHAAR_MILLISECONDS_PER_SECOND);

  return BigInt(seconds);
}

/** Whether the QR was signed at most the config's window before `now`, in seconds; a signing time after `now` counts as fresh. */
export function isFresh(proof: AadhaarProof, config: AadhaarConfig, now: bigint): boolean {
  const signedAt = inputAt(proof.inputs, 'timestamp');

  return signedAt !== undefined && !(signedAt < now && now - signedAt > config.freshnessWindow);
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
 * The local verdict, read off no chain and no clock: `rejected` for bytes that do not decode or
 * a proof `bindsTo` refuses, else the stack's answer, or `not-judged` when the stack throws.
 */
export async function judge(stack: AnonAadhaarStack, config: Hex, digest: Hex, proof: Hex): Promise<Verdict> {
  assertBytes32(digest, METHOD_AADHAAR_DIGEST_NAME);

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
