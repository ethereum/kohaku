import { METHOD_ZKPASSPORT_DECIMAL_PATTERN, METHOD_ZKPASSPORT_DEV_MODE } from '../constants';
import type { EnrollFailure, Hex, Material, ReplyFailure } from '../interfaces';
import type { Session, StackProof, ZkPassportStack, ZkPassportVerifierParameters } from '../types';
import { boundCustomData, digestText, identifierWord, isNonSalted, outerEvmProof, scopedNullifier } from './bindings';
import {
  configFromFields,
  decodeZkPassportConfig,
  encodeZkPassportConfig,
  encodeZkPassportProof,
  proofFromFields,
} from './codec';

const rejected: ReplyFailure = { kind: 'reply-failure', cause: 'material-rejected' };

const unavailable: ReplyFailure = { kind: 'reply-failure', cause: 'device-unavailable' };

const isRecord = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The outer proof's verifier parameters; `device-unavailable` where the stack does not load, `material-rejected` where it refuses the proof. */
const parametersFor = async (
  stack: ZkPassportStack,
  session: Session,
  proof: StackProof,
): Promise<ZkPassportVerifierParameters | ReplyFailure> => {
  let client;

  try {
    client = await stack(session.domain);
  } catch {
    return unavailable;
  }

  try {
    const params = client.getSolidityVerifierParameters({
      proof,
      scope: session.scope,
      domain: session.domain,
      devMode: METHOD_ZKPASSPORT_DEV_MODE,
    });

    return params.serviceConfig.devMode === METHOD_ZKPASSPORT_DEV_MODE ? params : rejected;
  } catch {
    return rejected;
  }
};

const isFailure = (value: unknown): value is ReplyFailure => isRecord(value) && value['kind'] === 'reply-failure';

/**
 * The config built from `material.result` and the stack's verifier parameters for the session.
 * Rejected unless the result verified, holds an outer EVM proof, and its non-zero identifier is that proof's non-salted scoped nullifier.
 */
export const enrolledConfig = async (
  stack: ZkPassportStack,
  session: Session,
  material: Material,
): Promise<Hex | EnrollFailure> => {
  const result = isRecord(material) ? material['result'] : undefined;

  if (!isRecord(result) || result['verified'] !== true) return rejected;

  const identifier = result['uniqueIdentifier'];
  const outer = outerEvmProof(result['proofs']);

  if (typeof identifier !== 'string' || !METHOD_ZKPASSPORT_DECIMAL_PATTERN.test(identifier) || outer === undefined) return rejected;

  const params = await parametersFor(stack, session, outer);

  if (isFailure(params)) return params;

  const inputs = params.proofVerificationData.publicInputs;
  const unique = BigInt(identifier);

  if (unique === 0n || scopedNullifier(inputs) !== unique || !isNonSalted(inputs)) return rejected;

  try {
    const config = configFromFields({
      uniqueIdentifier: identifierWord(unique),
      version: params.version,
      domain: params.serviceConfig.domain,
      scope: params.serviceConfig.scope,
      validityPeriodInSeconds: params.serviceConfig.validityPeriodInSeconds,
    });

    return encodeZkPassportConfig(config);
  } catch {
    return rejected;
  }
};

/**
 * The proof layout packaged from the outer EVM proof in `material.proofs`.
 * Rejected unless that proof binds the digest's text and its scoped nullifier is the config's unique identifier.
 */
export const packagedProof = async (
  stack: ZkPassportStack,
  session: Session,
  config: Hex,
  digest: Hex,
  material: Material,
): Promise<Hex | ReplyFailure> => {
  const outer = outerEvmProof(isRecord(material) ? material['proofs'] : undefined);

  if (outer === undefined) return rejected;

  let expected: string;
  let committed: bigint;

  try {
    expected = digestText(digest);
    committed = BigInt(decodeZkPassportConfig(config).uniqueIdentifier);
  } catch {
    return rejected;
  }

  const params = await parametersFor(stack, session, outer);

  if (isFailure(params)) return params;

  const { vkeyHash, proof, publicInputs } = params.proofVerificationData;

  if (boundCustomData(outer) !== expected || scopedNullifier(publicInputs) !== committed) return rejected;

  try {
    const packaged = proofFromFields({
      proofVerificationData: { vkeyHash, proof, publicInputs: [...publicInputs] },
      committedInputs: params.committedInputs,
    });

    return encodeZkPassportProof(packaged);
  } catch {
    return rejected;
  }
};
