import { FORMATS_ZERO_ADDRESS } from '../constants/formats';
import {
  METHOD_AADHAAR_ARTIFACT_ORIGIN_MESSAGE,
  METHOD_AADHAAR_ARTIFACT_ORIGINS,
  METHOD_AADHAAR_ARTIFACT_URL_MESSAGE,
  METHOD_AADHAAR_DEFAULT_TEST_MODE,
  METHOD_AADHAAR_DEVICE_BINDING,
  METHOD_AADHAAR_DEVICE_FACTS,
  METHOD_AADHAAR_ENROLL_KIND,
  METHOD_AADHAAR_FRESHNESS_WINDOW,
  METHOD_AADHAAR_MATERIAL_REJECTED,
  METHOD_AADHAAR_MIN_FRESHNESS_WINDOW,
  METHOD_AADHAAR_REQUEST_UNSUPPORTED,
  METHOD_AADHAAR_SEED_MISMATCH_MESSAGE,
  METHOD_AADHAAR_SEED_PARAM,
  METHOD_AADHAAR_STACK_AND_ARTIFACTS_MESSAGE,
  METHOD_AADHAAR_VECTOR_FILES,
} from '../constants/method-aadhaar';
import { sameAddress } from '../formats/guards';
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
import type { AadhaarConfig, AnonAadhaarArtifacts, AnonAadhaarMethodOptions, AnonAadhaarStack } from '../types/method-aadhaar';
import { aadhaarCodec, decodeConfig, encodeConfig, encodeProof } from './codec';
import { argsOptions, readInput, readMaterial, readParams } from './inputs';
import { abortFailure, isFailure, packProof, runProver, untilSettled } from './prover';
import { isDigest, signalFromDigest, signalHashFromDigest } from './signal';
import { coreStack } from './stack';
import { bindsTo, isFresh, judge, nowInSeconds } from './verdict';
import { inputAt } from './words';

export class AnonAadhaarMethod implements IRecoveryMethod {
  readonly codec: IMethodCodec = aadhaarCodec;
  readonly deviceBinding: DeviceBinding = METHOD_AADHAAR_DEVICE_BINDING;
  readonly vector: readonly string[] = METHOD_AADHAAR_VECTOR_FILES;
  readonly #stack: AnonAadhaarStack;
  readonly #testMode: boolean;

  constructor(stack: AnonAadhaarStack, testMode: boolean) {
    this.#stack = stack;
    this.#testMode = testMode;
  }

  /** The deployed module, or none where the deployment carries the zero address for this method. */
  modules(descriptor: DeploymentDescriptor): readonly Address[] {
    return sameAddress(descriptor.methodAadhaar, FORMATS_ZERO_ADDRESS) ? [] : [descriptor.methodAadhaar];
  }

  /** The enrollment ceremony's proving arguments, all but the QR code. */
  enrollInput(params: Params): EnrollInput {
    const { nullifierSeed, certificateFile } = readParams(params);

    return { kind: METHOD_AADHAAR_ENROLL_KIND, nullifierSeed, certificateFile, fieldsToRevealArray: [] };
  }

  /** Proves once, under the stack's default signal, and returns the nullifier, its seed and the fixed window as the config. */
  async configFrom(input: EnrollInput, material: Material): Promise<Hex | EnrollFailure> {
    const params = input?.kind === METHOD_AADHAAR_ENROLL_KIND ? readInput(input) : undefined;
    const supplied = readMaterial(material);

    if (params === undefined || supplied === undefined) return METHOD_AADHAAR_MATERIAL_REJECTED;

    const pcd = await runProver(this.#stack, argsOptions(params, supplied.qrData), supplied);

    if (isFailure(pcd)) return pcd;

    const packed = packProof(pcd);
    const nullifier = packed === undefined ? undefined : inputAt(packed.inputs, 'nullifier');
    const seedKept = packed !== undefined && inputAt(packed.inputs, 'nullifierSeed') === params.nullifierSeed;

    if (nullifier === undefined || !seedKept) return METHOD_AADHAAR_MATERIAL_REJECTED;

    return encodeConfig({ nullifier, nullifierSeed: params.nullifierSeed, freshnessWindow: METHOD_AADHAAR_FRESHNESS_WINDOW });
  }

  /** The proving arguments with the digest as the signal; a `TypeError` or `RangeError` for malformed params or a seed the config does not hold. */
  signingInput(ctx: Ctx, params?: Params): Input {
    const { nullifierSeed, certificateFile } = readParams(params);
    const config = decodeConfig(ctx.request.config);

    if (config.nullifierSeed !== nullifierSeed) {
      throw new TypeError(`${METHOD_AADHAAR_SEED_PARAM} ${METHOD_AADHAAR_SEED_MISMATCH_MESSAGE}`);
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
   * Proves over the digest and returns the proof unless its bindings fail, the QR is older than the config's window
   * by the system clock, or the local verdict rejects it. A config window under the minimum is `request-unsupported`
   * before proving. The chain accepts the proof until one window after the QR's signing time, whatever the request's
   * validity, so the holder's simulation refuses one that aged. An abort at any point, verification included, is `device-refused`.
   */
  async replyFrom(ctx: Ctx, input: Input, material: Material): Promise<Hex | ReplyFailure> {
    const params = readInput(input);
    const supplied = readMaterial(material);

    if (params === undefined || supplied === undefined) return METHOD_AADHAAR_MATERIAL_REJECTED;

    const aborted = abortFailure(supplied.signal);

    if (aborted !== undefined) return aborted;

    let config: AadhaarConfig;

    try {
      config = decodeConfig(ctx.request.config);
    } catch {
      return METHOD_AADHAAR_REQUEST_UNSUPPORTED;
    }

    if (config.freshnessWindow < METHOD_AADHAAR_MIN_FRESHNESS_WINDOW) return METHOD_AADHAAR_REQUEST_UNSUPPORTED;

    if (!isDigest(ctx.digest)) return METHOD_AADHAAR_REQUEST_UNSUPPORTED;

    if (config.nullifierSeed !== params.nullifierSeed) return METHOD_AADHAAR_MATERIAL_REJECTED;

    const options = argsOptions(params, supplied.qrData, signalFromDigest(ctx.digest));
    const pcd = await runProver(this.#stack, options, supplied);

    if (isFailure(pcd)) return pcd;

    const packed = packProof(pcd);

    if (packed === undefined || !bindsTo(packed, config, ctx.digest)) return METHOD_AADHAAR_MATERIAL_REJECTED;

    if (!isFresh(packed, config, nowInSeconds())) return METHOD_AADHAAR_MATERIAL_REJECTED;

    const proof = encodeProof(packed);

    const verdict = await untilSettled(judge(this.#stack, ctx.request.config, ctx.digest, proof, this.#testMode), supplied.signal);

    if (isFailure(verdict)) return verdict;

    return verdict === 'rejected' ? METHOD_AADHAAR_MATERIAL_REJECTED : proof;
  }

  verify(ctx: Ctx, proof: Hex): Promise<Verdict> {
    return judge(this.#stack, ctx.request.config, ctx.digest, proof, this.#testMode);
  }

  /** A fresh copy of the method's device facts. */
  describe(): DeviceFacts {
    return { ...METHOD_AADHAAR_DEVICE_FACTS };
  }
}

/** The artifacts' four members, copied by name so no other member reaches the stack. */
function readArtifacts(artifacts: AnonAadhaarArtifacts): AnonAadhaarArtifacts {
  const { wasmURL, zkeyURL, vkeyURL, artifactsOrigin } = artifacts;
  const urls = [wasmURL, zkeyURL, vkeyURL];

  if (!urls.every((url) => typeof url === 'string' && url !== '')) {
    throw new TypeError(METHOD_AADHAAR_ARTIFACT_URL_MESSAGE);
  }

  if (!(METHOD_AADHAAR_ARTIFACT_ORIGINS as readonly unknown[]).includes(artifactsOrigin)) {
    throw new TypeError(`${METHOD_AADHAAR_ARTIFACT_ORIGIN_MESSAGE} ${METHOD_AADHAAR_ARTIFACT_ORIGINS.join(', ')}`);
  }

  return { wasmURL, zkeyURL, vkeyURL, artifactsOrigin };
}

/** The Aadhaar method, over an injected stack or the installed `@anon-aadhaar/core`, either in test mode; passing both stacks throws. */
export function anonAadhaarMethod(options: AnonAadhaarMethodOptions = {}): IRecoveryMethod {
  if (options.stack !== undefined && options.artifacts !== undefined) {
    throw new TypeError(METHOD_AADHAAR_STACK_AND_ARTIFACTS_MESSAGE);
  }

  const stack = options.stack ?? coreStack(options.artifacts && readArtifacts(options.artifacts));

  return new AnonAadhaarMethod(stack, options.testMode ?? METHOD_AADHAAR_DEFAULT_TEST_MODE);
}
