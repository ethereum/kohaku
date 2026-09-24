import type { IMethodCodec } from './method-codec';
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
} from './records';

/**
 * The client-side half of one method module, one implementation per module
 * (D-201, D-206). `WalletMethod`, `PasskeyMethod`, `ZkPassportMethod` and
 * `AnonAadhaarMethod` are the shipped implementations.
 */
export interface IRecoveryMethod {
  /** The module addresses this implementation serves on the given deployment. */
  modules(descriptor: DeploymentDescriptor): readonly Address[];
  enrollInput(params: Params): EnrollInput;
  /** The config bytes, or `EnrollFailure` naming why the material was not a config. */
  configFrom(input: EnrollInput, material: Material): Promise<Hex | EnrollFailure>;
  signingInput(ctx: Ctx, params?: Params): Input;
  /** The proof bytes, or `ReplyFailure` naming the cause. */
  replyFrom(ctx: Ctx, input: Input, material: Material): Promise<Hex | ReplyFailure>;
  /** The local check under the method's own cryptography, reading no chain. */
  verify(ctx: Ctx, proof: Hex): Promise<Verdict>;
  readonly codec: IMethodCodec;
  readonly deviceBinding: DeviceBinding;
  describe(ctx: Ctx): DeviceFacts;
  /** The vector files under design/kats/ this implementation's tests replay. */
  readonly vector: readonly string[];
}
