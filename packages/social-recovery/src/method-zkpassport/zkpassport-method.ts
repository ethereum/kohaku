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
import type { ZkPassportConfig, ZkPassportStack } from '../types';
import { acceptedNullifierType, digestText, scopedNullifier, scopedTo } from './bindings';
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
   * The ceremony record for `params` `{ domain, scope, name?, logo?, purpose?, trustedKeys? }`, binding no custom field; `TypeError` on a missing domain or scope,
   * a domain the zkPassport stack would not keep as given, such as one with a scheme, path, port or capital letter, or `trustedKeys` that are not the module's
   * eight 32-byte words with a version word first. `trustedKeys` is the module's list as the integrator read it from `trustedParties`; where given,
   * `configFrom` refuses a proof of another version as `material-untrusted`.
   * Its `openRequest`: a second scan of one request's code makes the bridge refuse the second handshake with no event on the record; a page ends such a wait with `cancel()`.
   */
  enrollInput(params: Params): EnrollInput {
    const session = sessionFromParams(params);

    return { kind: 'ceremony', ...session, openRequest: opener(this.#stack, session, undefined, this.#devMode) };
  }

  /**
   * The config from `material.result` and the proofs in `material.result.proofs` or else `material.proofs`, committing the domain and scope the input carries.
   * `material-rejected` where the input's domain is one the stack would rewrite or the proof's service scope and subscope words are not their hashes;
   * `material-untrusted`, before those word checks, where the input carries `trustedKeys` and the proof's version word, `zkPassportVersionWord(outer.version)`
   * for the outer proof, is not their first: the app proved under a version the module does not route now.
   */
  async configFrom(input: EnrollInput, material: Material): Promise<Hex | EnrollFailure> {
    const session = input.kind === 'ceremony' ? sessionFromInput(input) : undefined;

    if (session === undefined) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

    return enrolledConfig(this.#stack, session, material, this.#devMode);
  }

  /**
   * The signing record for `params`, binding the digest's text as `customData`; `TypeError` on a missing domain or scope, a domain the stack would not keep
   * as given, `trustedKeys` that are not the module's eight 32-byte words with a version word first, or a digest that is not hex, `RangeError` on a digest
   * that is not 32 bytes. The domain and scope must be the config's: `replyFrom` refuses a proof made for another domain or scope. Where the optional
   * `trustedKeys` are given, as the approval page read them from `trustedParties`, `replyFrom` refuses a proof of another version as `material-untrusted`.
   * Its `openRequest`: a second scan of one request's code makes the bridge refuse the second handshake with no event on the record; a page ends such a wait with `cancel()`.
   */
  signingInput(ctx: Ctx, params?: Params): Input {
    const session = sessionFromParams(params);
    const customData = digestText(ctx.digest);

    return { ...session, customData, openRequest: opener(this.#stack, session, customData, this.#devMode) };
  }

  /**
   * The proof from `material.proofs`, under the domain and scope the input carries; `request-unsupported` where the config's domain is one the stack
   * would rewrite or its domain or scope is empty, and `material-rejected` where the proof's service scope and subscope words are not their hashes.
   * `material-untrusted`, after `request-unsupported` and before those word checks, where the input carries `trustedKeys` and the proof's version word,
   * `zkPassportVersionWord(outer.version)` for the outer proof, is not their first: the app proved under a version the module does not route now.
   */
  async replyFrom(ctx: Ctx, input: Input, material: Material): Promise<Hex | ReplyFailure> {
    const session = sessionFromInput(input);

    if (session === undefined) return METHOD_ZKPASSPORT_MATERIAL_REJECTED;

    return packagedProof(this.#stack, session, ctx.request.config, ctx.digest, material, this.#devMode);
  }

  /**
   * Rejected on bytes outside the two layouts, a zero identifier, a nullifier type the mode does not accept (the non-salted one, and in dev mode the fake passport's),
   * a scoped nullifier other than the config's, or service scope and subscope words that are not the hashes of the config's domain and scope.
   * Otherwise not judged, since only the chain's verifier checks the outer EVM proof and this member never calls it.
   */
  async verify(ctx: Ctx, proof: Hex): Promise<Verdict> {
    let config: ZkPassportConfig;
    let inputs: readonly string[];

    try {
      config = decodeZkPassportConfig(ctx.request.config);
      inputs = decodeZkPassportProof(proof).proofVerificationData.publicInputs;
    } catch {
      return 'rejected';
    }

    const unique = BigInt(config.uniqueIdentifier);

    if (
      unique === 0n ||
      !acceptedNullifierType(inputs, this.#devMode) ||
      scopedNullifier(inputs) !== unique ||
      !scopedTo(inputs, config.domain, config.scope)
    ) {
      return 'rejected';
    }

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
