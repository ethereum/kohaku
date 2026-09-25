import { METHOD_ZKPASSPORT_APP, METHOD_ZKPASSPORT_VECTOR_FILES } from '../constants';
import { METHOD_ZKPASSPORT_STACK_STANDING } from '../constants/method-zkpassport-stack';
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
import { digestText, isNonSalted, scopedNullifier } from './bindings';
import { decodeZkPassportConfig, decodeZkPassportProof, zkPassportCodec } from './codec';
import { enrolledConfig, packagedProof } from './material';
import { opener, sessionFromInput, sessionFromParams } from './session';

const rejected: ReplyFailure = { kind: 'reply-failure', cause: 'material-rejected' };

/** A passport or national identity card as the credential, proven in the approver's zkPassport app. */
export class ZkPassportMethod implements IRecoveryMethod {
  readonly codec: IMethodCodec = zkPassportCodec;

  readonly deviceBinding: DeviceBinding = 'external-app';

  readonly vector: readonly string[] = [...METHOD_ZKPASSPORT_VECTOR_FILES];

  readonly #stack: ZkPassportStack;

  constructor(stack: ZkPassportStack) {
    this.#stack = stack;
  }

  /** The `method-zkpassport` address the descriptor names. */
  modules(descriptor: DeploymentDescriptor): readonly Address[] {
    return [descriptor.methodZkpassport];
  }

  /** The ceremony record for `params` `{ domain, scope, name?, logo?, purpose? }`, binding no custom field; throws on a missing domain or scope. */
  enrollInput(params: Params): EnrollInput {
    const session = sessionFromParams(params);

    return { kind: 'ceremony', ...session, openRequest: opener(this.#stack, session, undefined) };
  }

  /** The config from `material.result`, under the domain and scope the input carries. */
  async configFrom(input: EnrollInput, material: Material): Promise<Hex | EnrollFailure> {
    const session = input.kind === 'ceremony' ? sessionFromInput(input) : undefined;

    if (session === undefined) return rejected;

    return enrolledConfig(this.#stack, session, material);
  }

  /** The signing record for `params`, binding the digest's text as `customData`; throws on a missing domain or scope or a digest that is not 32 bytes. */
  signingInput(ctx: Ctx, params?: Params): Input {
    const session = sessionFromParams(params);
    const customData = digestText(ctx.digest);

    return { ...session, customData, openRequest: opener(this.#stack, session, customData) };
  }

  /** The proof from `material.proofs`, under the domain and scope the input carries. */
  async replyFrom(ctx: Ctx, input: Input, material: Material): Promise<Hex | ReplyFailure> {
    const session = sessionFromInput(input);

    if (session === undefined) return rejected;

    return packagedProof(this.#stack, session, ctx.request.config, ctx.digest, material);
  }

  /**
   * Rejected on bytes outside the two layouts, a zero identifier, a nullifier type other than the non-salted one, or a scoped nullifier other than the config's.
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

    if (unique === 0n || !isNonSalted(inputs) || scopedNullifier(inputs) !== unique) return 'rejected';

    return 'not-judged';
  }

  /** The facts about the zkPassport app the approver proves in. */
  describe(ctx: Ctx): DeviceFacts {
    void ctx;

    return {
      kind: 'external-proving-app',
      app: METHOD_ZKPASSPORT_APP,
      showsNameLogoPurpose: true,
      stack: { ...METHOD_ZKPASSPORT_STACK_STANDING },
    };
  }
}
