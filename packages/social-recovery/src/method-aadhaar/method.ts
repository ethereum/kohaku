import { METHOD_AADHAAR_ARTIFACT_ORIGINS, METHOD_AADHAAR_DEVICE_BINDING, METHOD_AADHAAR_DEVICE_FACTS, METHOD_AADHAAR_VECTOR_FILES } from '../constants/method-aadhaar';
import type {
  Address,
  Ctx,
  DeploymentDescriptor,
  DeviceBinding,
  DeviceFacts,
  EnrollFailure,
  EnrollInput,
  Hex,
  IMethodCodec,
  Input,
  IRecoveryMethod,
  Material,
  Params,
  ReplyFailure,
  Verdict,
} from '../interfaces';
import type { AadhaarConfig, AnonAadhaarArtifacts, AnonAadhaarMethodOptions, AnonAadhaarStack } from '../types';
import { aadhaarCodec, decodeConfig, encodeConfig, encodeProof } from './codec';
import { argsOptions, readInput, readMaterial, readParams } from './inputs';
import { abortFailure, failure, isFailure, packProof, runProver, untilSettled } from './prover';
import { isDigest, signalFromDigest, signalHashFromDigest } from './signal';
import { coreStack } from './stack';
import { bindsTo, judge } from './verdict';
import { inputAt } from './words';

export class AnonAadhaarMethod implements IRecoveryMethod {
  readonly codec: IMethodCodec = aadhaarCodec;
  readonly deviceBinding: DeviceBinding = METHOD_AADHAAR_DEVICE_BINDING;
  readonly vector: readonly string[] = METHOD_AADHAAR_VECTOR_FILES;
  readonly #stack: AnonAadhaarStack;

  constructor(stack: AnonAadhaarStack) {
    this.#stack = stack;
  }

  modules(descriptor: DeploymentDescriptor): readonly Address[] {
    return [descriptor.methodAadhaar];
  }

  /** The enrollment ceremony's proving arguments, all but the QR code. */
  enrollInput(params: Params): EnrollInput {
    const { nullifierSeed, certificateFile } = readParams(params);

    return { kind: 'ceremony', nullifierSeed, certificateFile, fieldsToRevealArray: [] };
  }

  /** Proves once, under the stack's default signal, and returns the nullifier with its seed as the config. */
  async configFrom(input: EnrollInput, material: Material): Promise<Hex | EnrollFailure> {
    const params = input?.kind === 'ceremony' ? readInput(input) : undefined;
    const supplied = readMaterial(material);

    if (params === undefined || supplied === undefined) return failure('material-rejected');

    const pcd = await runProver(this.#stack, argsOptions(params, supplied.qrData), supplied);

    if (isFailure(pcd)) return pcd;

    const packed = packProof(pcd);
    const nullifier = packed === undefined ? undefined : inputAt(packed.inputs, 'nullifier');
    const seedKept = packed !== undefined && inputAt(packed.inputs, 'nullifierSeed') === params.nullifierSeed;

    if (nullifier === undefined || !seedKept) return failure('material-rejected');

    return encodeConfig({ nullifier, nullifierSeed: params.nullifierSeed });
  }

  /** The proving arguments with the digest as the signal; throws before any device is asked. */
  signingInput(ctx: Ctx, params?: Params): Input {
    const { nullifierSeed, certificateFile } = readParams(params);
    const config = decodeConfig(ctx.request.config);

    if (config.nullifierSeed !== nullifierSeed) {
      throw new Error('nullifierSeed is not the seed the config was enrolled under');
    }

    return {
      nullifierSeed,
      certificateFile,
      fieldsToRevealArray: [],
      signal: signalFromDigest(ctx.digest),
      signalHash: signalHashFromDigest(ctx.digest),
    };
  }

  /**
   * Proves over the digest and returns the proof unless its bindings fail or the
   * local verdict rejects it. An abort at any point, verification included, is `device-refused`.
   */
  async replyFrom(ctx: Ctx, input: Input, material: Material): Promise<Hex | ReplyFailure> {
    const params = readInput(input);
    const supplied = readMaterial(material);

    if (params === undefined || supplied === undefined) return failure('material-rejected');

    const aborted = abortFailure(supplied.signal);

    if (aborted !== undefined) return aborted;

    let config: AadhaarConfig;

    try {
      config = decodeConfig(ctx.request.config);
    } catch {
      return failure('request-unsupported');
    }

    if (!isDigest(ctx.digest)) return failure('request-unsupported');

    if (config.nullifierSeed !== params.nullifierSeed) return failure('material-rejected');

    const options = argsOptions(params, supplied.qrData, signalFromDigest(ctx.digest));
    const pcd = await runProver(this.#stack, options, supplied);

    if (isFailure(pcd)) return pcd;

    const packed = packProof(pcd);

    if (packed === undefined || !bindsTo(packed, config, ctx.digest)) return failure('material-rejected');

    const proof = encodeProof(packed);

    const verdict = await untilSettled(judge(this.#stack, ctx.request.config, ctx.digest, proof), supplied.signal);

    if (isFailure(verdict)) return verdict;

    return verdict === 'rejected' ? failure('material-rejected') : proof;
  }

  verify(ctx: Ctx, proof: Hex): Promise<Verdict> {
    return judge(this.#stack, ctx.request.config, ctx.digest, proof);
  }

  /** A fresh copy of the method's device facts. */
  describe(): DeviceFacts {
    return { ...METHOD_AADHAAR_DEVICE_FACTS };
  }
}

function readArtifacts(artifacts: AnonAadhaarArtifacts): AnonAadhaarArtifacts {
  const urls = [artifacts.wasmURL, artifacts.zkeyURL, artifacts.vkeyURL];

  if (!urls.every((url) => typeof url === 'string' && url !== '')) {
    throw new TypeError('an artifact URL is not a non-empty string');
  }

  if (!(METHOD_AADHAAR_ARTIFACT_ORIGINS as readonly unknown[]).includes(artifacts.artifactsOrigin)) {
    throw new TypeError(`artifactsOrigin is not one of ${METHOD_AADHAAR_ARTIFACT_ORIGINS.join(', ')}`);
  }

  return { ...artifacts };
}

/** The Aadhaar method, over an injected stack or the installed `@anon-aadhaar/core`; passing both throws. */
export function anonAadhaarMethod(options: AnonAadhaarMethodOptions = {}): IRecoveryMethod {
  if (options.stack !== undefined && options.artifacts !== undefined) {
    throw new TypeError('pass a stack or the artifacts for the installed stack, not both');
  }

  return new AnonAadhaarMethod(options.stack ?? coreStack(options.artifacts && readArtifacts(options.artifacts)));
}
