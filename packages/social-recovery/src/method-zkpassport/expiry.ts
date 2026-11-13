import { METHOD_ZKPASSPORT_PROOF_DATE_INPUT, METHOD_ZKPASSPORT_PROOF_DATE_MESSAGE, METHOD_ZKPASSPORT_SCOPED_MIN_PUBLIC_INPUTS } from '../constants';
import type { Hex } from '../interfaces';
import type { ZkPassportConfig, ZkPassportProof } from '../types';

/**
 * The proof's date plus the config's validity period, the first block timestamp at which the module refuses the proof for its age;
 * `RangeError` on a proof with fewer public inputs than an outer proof carries.
 */
export const zkPassportProofExpiry = (config: ZkPassportConfig, proof: ZkPassportProof): bigint => {
  const inputs = proof.proofVerificationData.publicInputs;

  if (inputs.length < METHOD_ZKPASSPORT_SCOPED_MIN_PUBLIC_INPUTS) throw new RangeError(METHOD_ZKPASSPORT_PROOF_DATE_MESSAGE);

  return BigInt(inputs[METHOD_ZKPASSPORT_PROOF_DATE_INPUT] as Hex) + config.validityPeriodInSeconds;
};
