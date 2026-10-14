import {
  METHOD_ZKPASSPORT_DEV_MODE,
  METHOD_ZKPASSPORT_DEVICE_UNAVAILABLE,
  METHOD_ZKPASSPORT_MATERIAL_REJECTED,
} from '../constants';
import { METHOD_ZKPASSPORT_DECIMAL_PATTERN } from '../constants/method-zkpassport-parse';
import type { EnrollFailure, Hex, Material, ReplyFailure } from '../interfaces';
import type { ZkPassportProof, ZkPassportSession, ZkPassportStack, ZkPassportStackProof, ZkPassportVerifierParameters } from '../types';
import { boundCustomData, digestText, identifierWord, isNonSalted, isRecord, outerEvmProof, scopedNullifier } from './bindings';
import {
  configFromFields,
  decodeZkPassportConfig,
  encodeZkPassportConfig,
  encodeZkPassportProof,
  proofFromFields,
} from './codec';

/** The stack's verifier parameters for the outer proof, with their proof part checked whole; `device-unavailable` where the stack does not load, `material-rejected` where it refuses the proof or answers a malformed one. */
const checkedParameters = async (
  stack: ZkPassportStack,
  session: ZkPassportSession,
  outer: ZkPassportStackProof,
): Promise<{ readonly params: ZkPassportVerifierParameters; readonly proof: ZkPassportProof } | ReplyFailure> => {
  let client;

  try {
    client = await stack(session.domain);
  } catch {
    return METHOD_ZKPASSPORT_DEVICE_UNAVAILABLE;
  }

  try {
    const params = client.getSolidityVerifierParameters({
      proof: outer,
      scope: session.scope,
      domain: session.domain,
      devMode: METHOD_ZKPASSPORT_DEV_MODE,
    });

    if (params.serviceConfig.devMode !== METHOD_ZKPASSPORT_DEV_MODE) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

    const { vkeyHash, proof, publicInputs } = params.proofVerificationData;

    return { params, proof: proofFromFields({ proofVerificationData: { vkeyHash, proof, publicInputs }, committedInputs: params.committedInputs }) };
  } catch {
    return METHOD_ZKPASSPORT_MATERIAL_REJECTED;
  }
};

/** The outer EVM proof of a ceremony's proof list, or undefined where the list is malformed or holds none. */
const outerOf = (proofs: unknown): ZkPassportStackProof | undefined => {
  try {
    return outerEvmProof(proofs);
  } catch {
    return undefined;
  }
};

const isFailure = (value: unknown): value is ReplyFailure => isRecord(value) && value['kind'] === 'reply-failure';

/**
 * The config built from `material.result` and the stack's verifier parameters for the session.
 * Rejected unless the result verified, holds an outer EVM proof, and its non-zero identifier is that proof's non-salted scoped nullifier.
 */
export const enrolledConfig = async (
  stack: ZkPassportStack,
  session: ZkPassportSession,
  material: Material,
): Promise<Hex | EnrollFailure> => {
  const result = isRecord(material) ? material['result'] : undefined;

  if (!isRecord(result) || result['verified'] !== true) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

  const identifier = result['uniqueIdentifier'];
  const outer = outerOf(result['proofs']);

  if (typeof identifier !== 'string' || !METHOD_ZKPASSPORT_DECIMAL_PATTERN.test(identifier) || outer === undefined) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

  const checked = await checkedParameters(stack, session, outer);

  if (isFailure(checked)) return checked;

  const { params, proof } = checked;
  const inputs = proof.proofVerificationData.publicInputs;
  const unique = BigInt(identifier);

  if (unique === 0n || scopedNullifier(inputs) !== unique || !isNonSalted(inputs)) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

  try {
    const config = configFromFields({
      uniqueIdentifier: identifierWord(unique),
      domain: params.serviceConfig.domain,
      scope: params.serviceConfig.scope,
      validityPeriodInSeconds: params.serviceConfig.validityPeriodInSeconds,
    });

    return encodeZkPassportConfig(config);
  } catch {
    return METHOD_ZKPASSPORT_MATERIAL_REJECTED;
  }
};

/**
 * The proof layout packaged from the outer EVM proof in `material.proofs`.
 * Rejected unless that proof binds the digest's text and its scoped nullifier is the config's unique identifier.
 */
export const packagedProof = async (
  stack: ZkPassportStack,
  session: ZkPassportSession,
  config: Hex,
  digest: Hex,
  material: Material,
): Promise<Hex | ReplyFailure> => {
  const outer = outerOf(isRecord(material) ? material['proofs'] : undefined);

  if (outer === undefined) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

  let expected: string;
  let committed: bigint;

  try {
    expected = digestText(digest);
    committed = BigInt(decodeZkPassportConfig(config).uniqueIdentifier);
  } catch {
    return METHOD_ZKPASSPORT_MATERIAL_REJECTED;
  }

  const checked = await checkedParameters(stack, session, outer);

  if (isFailure(checked)) return checked;

  const { proof } = checked;

  if (boundCustomData(outer) !== expected || scopedNullifier(proof.proofVerificationData.publicInputs) !== committed) {
    return METHOD_ZKPASSPORT_MATERIAL_REJECTED;
  }

  return encodeZkPassportProof(proof);
};
