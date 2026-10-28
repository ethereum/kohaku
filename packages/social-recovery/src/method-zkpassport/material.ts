import { METHOD_ZKPASSPORT_DEVICE_UNAVAILABLE, METHOD_ZKPASSPORT_MATERIAL_REJECTED } from '../constants';
import { METHOD_ZKPASSPORT_DECIMAL_PATTERN } from '../constants/method-zkpassport-parse';
import type { EnrollFailure, Hex, Material, ReplyFailure } from '../interfaces';
import type { ZkPassportProof, ZkPassportSession, ZkPassportStack, ZkPassportStackProof, ZkPassportVerifierParameters } from '../types';
import { acceptedNullifierType, boundCustomData, digestText, identifierWord, isRecord, outerEvmProof, scopedNullifier } from './bindings';
import {
  configFromFields,
  decodeZkPassportConfig,
  encodeZkPassportConfig,
  encodeZkPassportProof,
  proofFromFields,
} from './codec';

/** The stack's verifier parameters for the outer proof under the method's dev mode, with their proof part checked whole; `device-unavailable` where the stack does not load, `material-rejected` where it refuses the proof or answers a malformed one or the other mode. */
const checkedParameters = async (
  stack: ZkPassportStack,
  session: ZkPassportSession,
  outer: ZkPassportStackProof,
  devMode: boolean,
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
      devMode,
    });

    if (params.serviceConfig.devMode !== devMode) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

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

/** The ceremony's proof list: `material.result.proofs` where the member is present, else `material.proofs`; an explicit `null` is a malformed list, not absence. */
const enrolledProofs = (material: { readonly [key: string]: unknown }, result: { readonly [key: string]: unknown }): unknown =>
  result['proofs'] === undefined ? material['proofs'] : result['proofs'];

/**
 * The config built from `material.result`, the ceremony's proof list and the stack's verifier parameters for the session.
 * Rejected unless the result verified, the list holds an outer EVM proof, and its non-zero identifier is that proof's scoped nullifier under a nullifier type the mode accepts.
 */
export const enrolledConfig = async (
  stack: ZkPassportStack,
  session: ZkPassportSession,
  material: Material,
  devMode: boolean,
): Promise<Hex | EnrollFailure> => {
  if (!isRecord(material)) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

  const result = material['result'];

  if (!isRecord(result) || result['verified'] !== true) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

  const identifier = result['uniqueIdentifier'];
  const outer = outerOf(enrolledProofs(material, result));

  if (typeof identifier !== 'string' || !METHOD_ZKPASSPORT_DECIMAL_PATTERN.test(identifier) || outer === undefined) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

  const checked = await checkedParameters(stack, session, outer, devMode);

  if (isFailure(checked)) return checked;

  const { params, proof } = checked;
  const inputs = proof.proofVerificationData.publicInputs;
  const unique = BigInt(identifier);

  if (unique === 0n || scopedNullifier(inputs) !== unique || !acceptedNullifierType(inputs, devMode)) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

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
 * Rejected unless that proof binds the digest's text, its scoped nullifier is the config's unique identifier and its nullifier type is one the mode accepts.
 */
export const packagedProof = async (
  stack: ZkPassportStack,
  session: ZkPassportSession,
  config: Hex,
  digest: Hex,
  material: Material,
  devMode: boolean,
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

  const checked = await checkedParameters(stack, session, outer, devMode);

  if (isFailure(checked)) return checked;

  const { proof } = checked;
  const inputs = proof.proofVerificationData.publicInputs;

  if (boundCustomData(outer) !== expected || scopedNullifier(inputs) !== committed || !acceptedNullifierType(inputs, devMode)) {
    return METHOD_ZKPASSPORT_MATERIAL_REJECTED;
  }

  return encodeZkPassportProof(proof);
};
