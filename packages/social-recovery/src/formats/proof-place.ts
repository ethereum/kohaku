import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { FORMATS_PLACE_BITS, FORMATS_PROOF_PLACE_ABI } from '../constants';
import type { Hex, ProofPlace } from '../interfaces';
import type { AbiProofPlace } from '../types';
import { assertBytes, assertBytes32, assertObject, assertUintNumber, normalizeAddress } from './guards';
import { decodeStrictly } from './strict';

/** A checked copy of one proof place, its method checksummed. */
function checkedProofPlace(proof: ProofPlace, name: string): ProofPlace {
  assertObject(proof, name);
  assertUintNumber(proof.place, FORMATS_PLACE_BITS, `${name}.place`);

  const method = normalizeAddress(proof.method, `${name}.method`);

  assertBytes(proof.config, `${name}.config`);
  assertBytes32(proof.salt, `${name}.salt`);
  assertBytes(proof.proof, `${name}.proof`);

  return { place: proof.place, method, config: proof.config, salt: proof.salt, proof: proof.proof };
}

/** Checked copies of the proofs sorted by place ascending; the caller's array is left as it was, and a repeated place throws a `RangeError`. */
export function sortedProofPlaces(proofs: readonly ProofPlace[]): ProofPlace[] {
  if (!Array.isArray(proofs)) {
    throw new TypeError('proofs must be an array');
  }

  const sorted = proofs.map((proof: ProofPlace, index) => checkedProofPlace(proof, `proofs[${index}]`));

  sorted.sort((left, right) => left.place - right.place);
  assertPlacesIncreasing(sorted, 'is repeated');

  return sorted;
}

/** Refuses proofs whose places are not strictly increasing, naming the first offending place. */
function assertPlacesIncreasing(proofs: readonly ProofPlace[], fault: string): void {
  let previous = -1;

  for (const { place } of proofs) {
    if (place <= previous) {
      throw new RangeError(`proofs place ${place} ${fault}: places must be strictly increasing`);
    }

    previous = place;
  }
}

/** The ABI form of a checked proof place. */
export function toAbiProofPlace(proof: ProofPlace): AbiProofPlace {
  return { ...proof, place: BigInt(proof.place) };
}

/** A decoded proof place with its place as a safe integer; a wider place throws a `RangeError` rather than wrapping. */
function fromAbiProofPlace(proof: AbiProofPlace, name: string): ProofPlace {
  if (proof.place > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${name}.place ${proof.place} does not fit a safe integer`);
  }

  return checkedProofPlace({ ...proof, place: Number(proof.place) }, name);
}

/** Decoded proofs in the order the bytes carry them; places out of order or repeated throw a `RangeError`. */
export function fromAbiProofPlaces(proofs: readonly AbiProofPlace[]): ProofPlace[] {
  const decoded = proofs.map((proof, index) => fromAbiProofPlace(proof, `proofs[${index}]`));

  assertPlacesIncreasing(decoded, 'is out of order or repeated');

  return decoded;
}

/** Encodes one proof place as a single tuple, so the bytes open with an offset word. */
export function encodeProofPlace(proof: ProofPlace): Hex {
  return encodeAbiParameters(FORMATS_PROOF_PLACE_ABI, [toAbiProofPlace(checkedProofPlace(proof, 'proof'))]);
}

/** Decodes one proof place, refusing bytes its encoder would not reproduce, trailing bytes among them. */
export function decodeProofPlace(encoded: Hex): ProofPlace {
  return decodeStrictly(encoded, 'proof', '(uint256, address, bytes, bytes32, bytes)', {
    decode: (bytes) => decodeAbiParameters(FORMATS_PROOF_PLACE_ABI, bytes)[0],
    build: (raw) => fromAbiProofPlace(raw, 'proof'),
    encode: encodeProofPlace,
  });
}
