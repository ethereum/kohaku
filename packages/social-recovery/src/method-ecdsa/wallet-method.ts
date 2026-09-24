import {
  METHOD_ECDSA_ADDRESS_PARAM,
  METHOD_ECDSA_DEVICE_BINDING,
  METHOD_ECDSA_DEVICE_KIND,
  METHOD_ECDSA_MATERIAL_REJECTED,
  METHOD_ECDSA_PROOF_FIELD,
  METHOD_ECDSA_VECTORS,
} from '../constants';
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
import { decodeSigner, encodeSigner, isGuardianAddress, walletCodec } from './codec';
import { byteLength, isHexBytes, keyPathPasses, normalizeSignature } from './signature';

const signerOf = (config: Hex): Address | undefined => {
  try {
    return decodeSigner(config);
  } catch {
    return undefined;
  }
};

/** A guardian enrolled by address with no ceremony, approving with one typed-data signature from their own wallet. */
export class WalletMethod implements IRecoveryMethod {
  readonly codec: IMethodCodec = walletCodec;

  readonly deviceBinding: DeviceBinding = METHOD_ECDSA_DEVICE_BINDING;

  readonly vector: readonly string[] = METHOD_ECDSA_VECTORS;

  /** The `method-ecdsa` address the descriptor names. */
  modules(descriptor: DeploymentDescriptor): readonly Address[] {
    return [descriptor.methodEcdsa];
  }

  /** Nothing to perform, carrying `params.address` through to `configFrom`. */
  enrollInput(params: Params): EnrollInput {
    return { kind: 'nothing-to-perform', [METHOD_ECDSA_ADDRESS_PARAM]: params[METHOD_ECDSA_ADDRESS_PARAM] };
  }

  /** The address as config bytes; `EnrollFailure` on a malformed or zero address. */
  async configFrom(input: EnrollInput, material: Material): Promise<Hex | EnrollFailure> {
    void material;

    if (input.kind !== 'nothing-to-perform') return METHOD_ECDSA_MATERIAL_REJECTED;

    const address: unknown = input[METHOD_ECDSA_ADDRESS_PARAM];

    if (!isGuardianAddress(address)) return METHOD_ECDSA_MATERIAL_REJECTED;

    return encodeSigner(address);
  }

  /** The typed data the ctx carries, handed to the wallet as it is. */
  signingInput(ctx: Ctx, params?: Params): Input {
    void params;

    return ctx.typedData;
  }

  /** The wallet's `signature` as the proof, lower-cased for a guardian holding code and otherwise normalized; `ReplyFailure` on empty or malformed bytes. */
  async replyFrom(ctx: Ctx, input: Input, material: Material): Promise<Hex | ReplyFailure> {
    void input;

    const signature: unknown =
      typeof material === 'object' && material !== null ? material[METHOD_ECDSA_PROOF_FIELD] : undefined;

    if (!isHexBytes(signature) || byteLength(signature) === 0) return METHOD_ECDSA_MATERIAL_REJECTED;

    if (ctx.request.credentialHoldsCode) return signature.toLowerCase() as Hex;

    return normalizeSignature(signature);
  }

  /** Rejected on an undecodable config or non-hex proof, not judged for a guardian holding code, else satisfied only where the signature recovers to the signer. */
  async verify(ctx: Ctx, proof: Hex): Promise<Verdict> {
    const signer = signerOf(ctx.request.config);

    if (signer === undefined || !isHexBytes(proof)) return 'rejected';

    if (ctx.request.credentialHoldsCode) return 'not-judged';

    return (await keyPathPasses(ctx.digest, proof, signer)) ? 'satisfied' : 'rejected';
  }

  /** The guardian's device facts, including whether the address holds code as the request states it. */
  describe(ctx: Ctx): DeviceFacts {
    const guardian = signerOf(ctx.request.config);

    return {
      kind: METHOD_ECDSA_DEVICE_KIND,
      ...(guardian === undefined ? {} : { guardian }),
      keyOrContractKnown: true,
      holdsCode: ctx.request.credentialHoldsCode,
    };
  }
}
