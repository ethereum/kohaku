import {
  FORMATS_ZERO_ADDRESS,
  METHOD_ZKPASSPORT_APP,
  METHOD_ZKPASSPORT_DEVICE_BINDING,
  METHOD_ZKPASSPORT_DEVICE_KIND,
  METHOD_ZKPASSPORT_MATERIAL_REJECTED,
  METHOD_ZKPASSPORT_VECTOR_FILES,
} from '../constants';
import { METHOD_ZKPASSPORT_STACK_STANDING } from '../constants/method-zkpassport-stack';
import { sameAddress } from '../formats/guards';
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
import type { ZkPassportStack } from '../types';
import { acceptedNullifierType, digestText, scopedNullifier } from './bindings';
import { decodeZkPassportConfig, decodeZkPassportProof, zkPassportCodec } from './codec';
import { enrolledConfig, packagedProof } from './material';
import { opener, sessionFromInput, sessionFromParams } from './session';

/** A passport or national identity card as the credential, proven in the approver's zkPassport app. */
export class ZkPassportMethod implements IRecoveryMethod {
  readonly codec: IMethodCodec = zkPassportCodec;

  readonly deviceBinding: DeviceBinding = METHOD_ZKPASSPORT_DEVICE_BINDING;

  readonly vector: readonly string[] = METHOD_ZKPASSPORT_VECTOR_FILES;

  readonly #stack: ZkPassportStack;

  readonly #devMode: boolean;

  constructor(stack: ZkPassportStack, devMode: boolean) {
    this.#stack = stack;
    this.#devMode = devMode;
  }

  /** The `method-zkpassport` address the descriptor names, or none where the deployment carries the zero address for an absent module. */
  modules(descriptor: DeploymentDescriptor): readonly Address[] {
    const address = descriptor.methodZkpassport;

    return sameAddress(address, FORMATS_ZERO_ADDRESS) ? [] : [address];
  }

  /**
   * The ceremony record for `params` `{ domain, scope, name?, logo?, purpose? }`, binding no custom field; `TypeError` on a missing domain or scope.
   * Its `openRequest`: a second scan of one request's code makes the bridge refuse the second handshake with no event on the record; a page ends such a wait with `cancel()`.
   */
  enrollInput(params: Params): EnrollInput {
    const session = sessionFromParams(params);

    return { kind: 'ceremony', ...session, openRequest: opener(this.#stack, session, undefined, this.#devMode) };
  }

  /** The config from `material.result` and the proofs in `material.result.proofs` or else `material.proofs`, under the domain and scope the input carries. */
  async configFrom(input: EnrollInput, material: Material): Promise<Hex | EnrollFailure> {
    const session = input.kind === 'ceremony' ? sessionFromInput(input) : undefined;

    if (session === undefined) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

    return enrolledConfig(this.#stack, session, material, this.#devMode);
  }

  /**
   * The signing record for `params`, binding the digest's text as `customData`; `TypeError` on a missing domain or scope or a digest that is not hex, `RangeError` on a digest that is not 32 bytes.
   * Its `openRequest`: a second scan of one request's code makes the bridge refuse the second handshake with no event on the record; a page ends such a wait with `cancel()`.
   */
  signingInput(ctx: Ctx, params?: Params): Input {
    const session = sessionFromParams(params);
    const customData = digestText(ctx.digest);

    return { ...session, customData, openRequest: opener(this.#stack, session, customData, this.#devMode) };
  }

  /** The proof from `material.proofs`, under the domain and scope the input carries. */
  async replyFrom(ctx: Ctx, input: Input, material: Material): Promise<Hex | ReplyFailure> {
    const session = sessionFromInput(input);

    if (session === undefined) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

    return packagedProof(this.#stack, session, ctx.request.config, ctx.digest, material, this.#devMode);
  }

  /**
   * Rejected on bytes outside the two layouts, a zero identifier, a nullifier type the mode does not accept (the non-salted one, and in dev mode the fake passport's), or a scoped nullifier other than the config's.
   * Otherwise not judged, since only the chain's verifier checks the outer EVM proof and this member never calls it.
   */
  async verify(ctx: Ctx, proof: Hex): Promise<Verdict> {
    let unique: bigint;
    let inputs: readonly string[];

    try {
      unique = BigInt(decodeZkPassportConfig(ctx.request.config).uniqueIdentifier);
      inputs = decodeZkPassportProof(proof).proofVerificationData.publicInputs;
    } catch {
      return 'rejected';
    }

    if (unique === 0n || !acceptedNullifierType(inputs, this.#devMode) || scopedNullifier(inputs) !== unique) return 'rejected';

    return 'not-judged';
  }

  /** The facts about the zkPassport app the approver proves in. */
  describe(ctx: Ctx): DeviceFacts {
    void ctx;

    return {
      kind: METHOD_ZKPASSPORT_DEVICE_KIND,
      app: METHOD_ZKPASSPORT_APP,
      showsNameLogoPurpose: true,
      stack: { ...METHOD_ZKPASSPORT_STACK_STANDING },
    };
  }
}
