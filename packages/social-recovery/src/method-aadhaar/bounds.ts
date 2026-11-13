import { METHOD_AADHAAR_CONFIG_FIELDS, METHOD_AADHAAR_MIN_FRESHNESS_WINDOW, METHOD_AADHAAR_SNARK_SCALAR_FIELD } from '../constants/method-aadhaar';
import type { AadhaarConfig } from '../types/method-aadhaar';

const [NULLIFIER_FIELD, SEED_FIELD, WINDOW_FIELD] = METHOD_AADHAAR_CONFIG_FIELDS;

/** Whether the verifier takes the word as a public input; it refuses every one at or above the circuit's field. */
const inField = (word: bigint): boolean => word < METHOD_AADHAAR_SNARK_SCALAR_FIELD;

/**
 * The config fields, in layout order, the module refuses at every proof: a nullifier or seed outside the circuit's field,
 * since the proof must carry both, and a freshness window under the minimum. The window has no maximum.
 */
export function aadhaarConfigOutOfBounds(config: AadhaarConfig): string[] {
  const refused: readonly (readonly [string, boolean])[] = [
    [NULLIFIER_FIELD, !inField(config.nullifier)],
    [SEED_FIELD, !inField(config.nullifierSeed)],
    [WINDOW_FIELD, config.freshnessWindow < METHOD_AADHAAR_MIN_FRESHNESS_WINDOW],
  ];

  return refused.filter(([, out]) => out).map(([field]) => field);
}
