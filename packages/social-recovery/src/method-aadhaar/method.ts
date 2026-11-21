import { FORMATS_ZERO_ADDRESS } from '../constants/formats';
import {
  METHOD_AADHAAR_DEVICE_BINDING,
  METHOD_AADHAAR_DEVICE_FACTS,
  METHOD_AADHAAR_ENROLL_KIND,
  METHOD_AADHAAR_MATERIAL_REJECTED,
  METHOD_AADHAAR_MATERIAL_UNTRUSTED,
  METHOD_AADHAAR_MIN_FRESHNESS_WINDOW,
  METHOD_AADHAAR_REQUEST_UNSUPPORTED,
  METHOD_AADHAAR_SEED_MISMATCH_MESSAGE,
  METHOD_AADHAAR_SEED_PARAM,
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
import type { AadhaarConfig, AnonAadhaarStack } from '../types/method-aadhaar';
import { aadhaarCodec, decodeConfig, encodeConfig, encodeProof } from './codec';
import { argsOptions, readInput, readInputWindow, readMaterial, readParams, readWindow } from './inputs';
import { abortFailure, isFailure, packProof, runProver, untilSettled } from './prover';
import { isDigest, signalFromDigest, signalHashFromDigest } from './signal';
import { readTrustedKey } from './trusted-key';
import { agedBeforeProving, bindsTo, isFresh, issuerTrusted, judge, nowInSeconds, replyVerdict } from './verdict';
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

  /**
   * The enrollment ceremony's proving arguments, all but the QR code, with the holder's freshness window, the default where the
   * params name none, and the module's trusted key where they give `trustedKeys`; a `TypeError` or `RangeError` for malformed params.
   */
  enrollInput(params: Params): EnrollInput {
    const { nullifierSeed, certificateFile } = readParams(params);
    const freshnessWindow = readWindow(params);
    const trustedKey = readTrustedKey(params);
    const ceremony = { kind: METHOD_AADHAAR_ENROLL_KIND, nullifierSeed, certificateFile, fieldsToRevealArray: [], freshnessWindow } as const;

    return trustedKey === undefined ? ceremony : { ...ceremony, trustedKey };
  }

  /**
   * Proves once, under the stack's default signal, and returns the nullifier, its seed and the input's freshness window as the
   * config, the default for an input that carries none; a window the bounds refuse is `material-rejected` before proving, and a
   * proof whose issuer key is not the input's trusted key is `material-untrusted`.
   * An abort settles it `device-refused` at once with no config, and no progress is forwarded after the signal aborts or the
   * call settles; the installed stack's proving runs on until it ends.
   */
  async configFrom(input: EnrollInput, material: Material): Promise<Hex | EnrollFailure> {
    const params = input?.kind === METHOD_AADHAAR_ENROLL_KIND ? readInput(input) : undefined;
    const freshnessWindow = readInputWindow(input);
    const supplied = readMaterial(material);

    if (params === undefined || freshnessWindow === undefined || supplied === undefined) return METHOD_AADHAAR_MATERIAL_REJECTED;

    const pcd = await runProver(this.#stack, argsOptions(params, supplied.qrData), supplied);

    if (isFailure(pcd)) return pcd;

    const packed = packProof(pcd);
    const nullifier = packed === undefined ? undefined : inputAt(packed.inputs, 'nullifier');
    const seedKept = packed !== undefined && inputAt(packed.inputs, 'nullifierSeed') === params.nullifierSeed;

    if (nullifier === undefined || !seedKept) return METHOD_AADHAAR_MATERIAL_REJECTED;

    if (!issuerTrusted(packed, params.trustedKey)) return METHOD_AADHAAR_MATERIAL_UNTRUSTED;

    return encodeConfig({ nullifier, nullifierSeed: params.nullifierSeed, freshnessWindow });
  }

  /**
   * The proving arguments with the digest as the signal, and the module's trusted key where the params give `trustedKeys`;
   * a `TypeError` or `RangeError` for malformed params or a seed the config does not hold.
   */
  signingInput(ctx: Ctx, params?: Params): Input {
    const { nullifierSeed, certificateFile } = readParams(params);
    const trustedKey = readTrustedKey(params);
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
      ...(trustedKey === undefined ? {} : { trustedKey }),
    };
  }

  /**
   * Proves over the digest and returns the proof unless its bindings fail, the QR is older than the config's window
   * by the system clock, or the local verdict rejects it. A config window under the minimum is `request-unsupported`
   * before proving, and a QR the stack's `signedAt` reads as older than the window by more than the slack is
   * `material-rejected` before proving. The chain accepts the proof until one window after the QR's signing time, whatever the request's
   * validity, so the holder's simulation refuses one that aged. A fresh proof whose issuer key is not the input's trusted key is
   * `material-untrusted` without the local verdict. A stack that cannot load or initialise, before proving or before the local
   * verdict, is `device-unavailable`. An abort at any point, the time read and verification included, is `device-refused`
   * at once with no proof, and no progress is forwarded after the signal aborts or the call settles; the installed stack's
   * download and proving run on until they end.
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

    const aging = agedBeforeProving(this.#stack, supplied.qrData, config, nowInSeconds());
    const aged = await untilSettled(aging, supplied.signal);

    if (isFailure(aged)) return aged;

    if (aged) return METHOD_AADHAAR_MATERIAL_REJECTED;

    const options = argsOptions(params, supplied.qrData, signalFromDigest(ctx.digest));
    const pcd = await runProver(this.#stack, options, supplied);

    if (isFailure(pcd)) return pcd;

    const packed = packProof(pcd);

    if (packed === undefined || !bindsTo(packed, config, ctx.digest)) return METHOD_AADHAAR_MATERIAL_REJECTED;

    if (!isFresh(packed, config, nowInSeconds())) return METHOD_AADHAAR_MATERIAL_REJECTED;

    if (!issuerTrusted(packed, params.trustedKey)) return METHOD_AADHAAR_MATERIAL_UNTRUSTED;

    const proof = encodeProof(packed);

    const verdict = await untilSettled(replyVerdict(this.#stack, ctx.request.config, ctx.digest, proof, this.#testMode), supplied.signal);

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
