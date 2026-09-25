import type { IMethodCodec, IRecoveryMethod } from '../interfaces';
import type {
  Address,
  Ctx,
  DeploymentDescriptor,
  DeviceBinding,
  DeviceFacts,
  EnrollFailure,
  EnrollInput,
  Hex,
  Input,
  Material,
  Params,
  ReplyFailure,
  Verdict,
} from '../interfaces';
import {
  METHOD_PASSKEY_DEVICE_BINDING,
  METHOD_PASSKEY_DEVICE_KIND,
  METHOD_PASSKEY_ERROR_PREFIX,
  METHOD_PASSKEY_MATERIAL_REJECTED,
  METHOD_PASSKEY_VECTOR_FILES,
} from '../constants';
import type { PasskeyConfig } from '../types';
import { readAssertion } from './assertion';
import { memberOf, rpIdHashOf } from './bytes';
import { checkAssertion } from './check';
import { decodePasskeyConfig, decodePasskeyProof, encodePasskeyConfig, encodePasskeyProof, passkeyCodec } from './codec';
import { enrolledKey } from './credential';
import { creationOptions, requestOptions } from './options';

const configOf = (config: Hex): PasskeyConfig | undefined => {
  try {
    return decodePasskeyConfig(config);
  } catch {
    return undefined;
  }
};

const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${METHOD_PASSKEY_ERROR_PREFIX}: "${name}" must be a non-empty string`);
  }

  return value;
};

const optionalText = (value: unknown, name: string): string | undefined =>
  value === undefined ? undefined : text(value, name);

/** The passkey recovery method; it holds no state, reads no chain and names no browser object. */
export class PasskeyMethod implements IRecoveryMethod {
  readonly codec: IMethodCodec = passkeyCodec;

  readonly deviceBinding: DeviceBinding = METHOD_PASSKEY_DEVICE_BINDING;

  readonly vector: readonly string[] = [...METHOD_PASSKEY_VECTOR_FILES];

  /** The `method-passkey` address the descriptor names. */
  modules(descriptor: DeploymentDescriptor): readonly Address[] {
    return [descriptor.methodPasskey];
  }

  /**
   * A ceremony carrying the creation options and the relying-party id `configFrom` reads back.
   * Throws unless `params.relyingPartyId` and `params.userName` are non-empty strings.
   */
  enrollInput(params: Params): EnrollInput {
    const relyingPartyId = text(params['relyingPartyId'], 'relyingPartyId');
    const userName = text(params['userName'], 'userName');

    return { kind: 'ceremony', relyingPartyId, userName, options: creationOptions(relyingPartyId, userName) };
  }

  /** The config of the key in `material.credential`, or `EnrollFailure` where it is not P-256 or has another rp hash. */
  async configFrom(input: EnrollInput, material: Material): Promise<Hex | EnrollFailure> {
    const relyingPartyId: unknown = input['relyingPartyId'];

    if (input.kind !== 'ceremony' || typeof relyingPartyId !== 'string' || relyingPartyId.length === 0) {
      return METHOD_PASSKEY_MATERIAL_REJECTED;
    }

    try {
      const key = enrolledKey(memberOf(material, 'credential'));
      const rpIdHash = rpIdHashOf(relyingPartyId);

      if (key === undefined || key.rpIdHash !== rpIdHash) return METHOD_PASSKEY_MATERIAL_REJECTED;

      return encodePasskeyConfig({ x: key.x, y: key.y, rpIdHash });
    } catch {
      return METHOD_PASSKEY_MATERIAL_REJECTED;
    }
  }

  /**
   * The request options with the digest as the challenge.
   * Throws before any device is asked unless `params.relyingPartyId`, and `params.credentialId` where given, are non-empty strings.
   */
  signingInput(ctx: Ctx, params?: Params): Input {
    const relyingPartyId = text(params?.['relyingPartyId'], 'relyingPartyId');
    const credentialId = optionalText(params?.['credentialId'], 'credentialId');

    return {
      relyingPartyId,
      ...(credentialId === undefined ? {} : { credentialId }),
      options: requestOptions(ctx.digest, relyingPartyId, credentialId),
    };
  }

  /** The proof in `material.assertion` once it passes the check list locally, or `ReplyFailure`. */
  async replyFrom(ctx: Ctx, input: Input, material: Material): Promise<Hex | ReplyFailure> {
    void input;

    try {
      const config = configOf(ctx.request.config);
      const proof = readAssertion(memberOf(material, 'assertion'));

      if (config === undefined || proof === undefined) return METHOD_PASSKEY_MATERIAL_REJECTED;

      if (checkAssertion(config, ctx.digest, proof) !== 'ok') return METHOD_PASSKEY_MATERIAL_REJECTED;

      return encodePasskeyProof(proof);
    } catch {
      return METHOD_PASSKEY_MATERIAL_REJECTED;
    }
  }

  /** `satisfied` where the proof passes the check list under the ctx's config and digest, `rejected` otherwise. */
  async verify(ctx: Ctx, proof: Hex): Promise<Verdict> {
    try {
      const config = configOf(ctx.request.config);

      if (config === undefined) return 'rejected';

      return checkAssertion(config, ctx.digest, decodePasskeyProof(proof)) === 'ok' ? 'satisfied' : 'rejected';
    } catch {
      return 'rejected';
    }
  }

  /** The device kind and the rp hash the config holds, where it decodes. */
  describe(ctx: Ctx): DeviceFacts {
    const config = configOf(ctx.request.config);

    return { kind: METHOD_PASSKEY_DEVICE_KIND, ...(config === undefined ? {} : { rpIdHash: config.rpIdHash }) };
  }
}
