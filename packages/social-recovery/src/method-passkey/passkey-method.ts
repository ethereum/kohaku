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
  METHOD_PASSKEY_ASSERTION_MATERIAL,
  METHOD_PASSKEY_CREDENTIAL_ID_PARAM,
  METHOD_PASSKEY_CREDENTIAL_MATERIAL,
  METHOD_PASSKEY_DEVICE_BINDING,
  METHOD_PASSKEY_DEVICE_KIND,
  METHOD_PASSKEY_ENROLL_INPUT_NAME,
  METHOD_PASSKEY_ERROR_PREFIX,
  METHOD_PASSKEY_MATERIAL_REJECTED,
  METHOD_PASSKEY_OPTIONS_MEMBER,
  METHOD_PASSKEY_PARAMS_NAME,
  METHOD_PASSKEY_RELYING_PARTY_ID_PARAM,
  METHOD_PASSKEY_TEXT_PARAM_MESSAGE,
  METHOD_PASSKEY_USER_NAME_PARAM,
  METHOD_PASSKEY_VECTOR_FILES,
} from '../constants';
import { assertObject } from '../formats/guards';
import type { PasskeyConfig } from '../types/method-passkey';
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
    throw new TypeError(`${METHOD_PASSKEY_ERROR_PREFIX}: "${name}" ${METHOD_PASSKEY_TEXT_PARAM_MESSAGE}`);
  }

  return value;
};

const optionalText = (value: unknown, name: string): string | undefined =>
  value === undefined ? undefined : text(value, name);

/** The passkey recovery method; it holds no state, reads no chain and names no browser object. */
export class PasskeyMethod implements IRecoveryMethod {
  readonly codec: IMethodCodec = passkeyCodec;

  readonly deviceBinding: DeviceBinding = METHOD_PASSKEY_DEVICE_BINDING;

  readonly vector: readonly string[] = METHOD_PASSKEY_VECTOR_FILES;

  /** The `method-passkey` address the descriptor names. */
  modules(descriptor: DeploymentDescriptor): readonly Address[] {
    return [descriptor.methodPasskey];
  }

  /**
   * A ceremony carrying the creation options and the relying-party id `configFrom` reads back.
   * A `TypeError` unless `params` is an object whose `relyingPartyId` and `userName` are non-empty strings.
   */
  enrollInput(params: Params): EnrollInput {
    assertObject(params, `${METHOD_PASSKEY_ERROR_PREFIX} ${METHOD_PASSKEY_PARAMS_NAME}`);

    const relyingPartyId = text(params[METHOD_PASSKEY_RELYING_PARTY_ID_PARAM], METHOD_PASSKEY_RELYING_PARTY_ID_PARAM);
    const userName = text(params[METHOD_PASSKEY_USER_NAME_PARAM], METHOD_PASSKEY_USER_NAME_PARAM);

    return {
      kind: 'ceremony',
      [METHOD_PASSKEY_RELYING_PARTY_ID_PARAM]: relyingPartyId,
      [METHOD_PASSKEY_USER_NAME_PARAM]: userName,
      [METHOD_PASSKEY_OPTIONS_MEMBER]: creationOptions(relyingPartyId, userName),
    };
  }

  /**
   * The config of the key in `material.credential`, or `EnrollFailure` where it is not P-256 or has another rp hash.
   * A `TypeError` where `input` is not an object.
   */
  async configFrom(input: EnrollInput, material: Material): Promise<Hex | EnrollFailure> {
    assertObject(input, `${METHOD_PASSKEY_ERROR_PREFIX} ${METHOD_PASSKEY_ENROLL_INPUT_NAME}`);

    const relyingPartyId: unknown = input[METHOD_PASSKEY_RELYING_PARTY_ID_PARAM];

    if (input.kind !== 'ceremony' || typeof relyingPartyId !== 'string' || relyingPartyId.length === 0) {
      return METHOD_PASSKEY_MATERIAL_REJECTED;
    }

    try {
      const key = enrolledKey(memberOf(material, METHOD_PASSKEY_CREDENTIAL_MATERIAL));
      const rpIdHash = rpIdHashOf(relyingPartyId);

      if (key === undefined || key.rpIdHash !== rpIdHash) return METHOD_PASSKEY_MATERIAL_REJECTED;

      return encodePasskeyConfig({ x: key.x, y: key.y, rpIdHash });
    } catch {
      return METHOD_PASSKEY_MATERIAL_REJECTED;
    }
  }

  /**
   * The request options with the digest as the challenge.
   * A `TypeError` before any device is asked unless `params.relyingPartyId`, and `params.credentialId` where given, are non-empty strings.
   */
  signingInput(ctx: Ctx, params?: Params): Input {
    const relyingPartyId = text(params?.[METHOD_PASSKEY_RELYING_PARTY_ID_PARAM], METHOD_PASSKEY_RELYING_PARTY_ID_PARAM);
    const credentialId = optionalText(params?.[METHOD_PASSKEY_CREDENTIAL_ID_PARAM], METHOD_PASSKEY_CREDENTIAL_ID_PARAM);

    return {
      [METHOD_PASSKEY_RELYING_PARTY_ID_PARAM]: relyingPartyId,
      ...(credentialId === undefined ? {} : { [METHOD_PASSKEY_CREDENTIAL_ID_PARAM]: credentialId }),
      [METHOD_PASSKEY_OPTIONS_MEMBER]: requestOptions(ctx.digest, relyingPartyId, credentialId),
    };
  }

  /** The proof in `material.assertion` once it passes the check list locally, or `ReplyFailure`. */
  async replyFrom(ctx: Ctx, input: Input, material: Material): Promise<Hex | ReplyFailure> {
    void input;

    try {
      const config = configOf(ctx.request.config);
      const proof = readAssertion(memberOf(material, METHOD_PASSKEY_ASSERTION_MATERIAL));

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
