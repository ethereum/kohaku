import { getAddress } from 'viem';
import {
  DEVICE_BINDINGS,
  MethodsOrchestrator,
  type ActionCodecRegistry,
  type Address,
  type ApproverRequest,
  type Ctx,
  type DeviceBinding,
  type DeviceFacts,
  type EnrollFailure,
  type EnrollInput,
  type Hex,
  type IActionCodec,
  type IRecoveryMethod,
  type Input,
  type Material,
  type MethodRegistry,
  type Params,
  type ReplyFailure,
  type Verdict,
} from '../../src/index';
import { approvalFromVector, cancellationFromVector, strictCodec } from '../description/request-fixtures';

/** The method address the blessed request rows name, all digits so every spelling of it is the same string. */
export const REQUEST_METHOD: Address = approvalFromVector().method;

/** A method address with letters, so its lower-case, upper-case and checksummed spellings differ. */
export const LETTERED_METHOD: Address = getAddress('0xabcdef0123456789abcdef0123456789abcdef01');

/** The lettered address with one letter's case flipped, so its EIP-55 checksum fails. */
export const BROKEN_CHECKSUM: Address = (() => {
  const index = [...LETTERED_METHOD].findIndex((char, at) => at > 1 && /[a-fA-F]/.test(char));
  const char = LETTERED_METHOD.charAt(index);
  const flipped = char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();

  return `${LETTERED_METHOD.slice(0, index)}${flipped}${LETTERED_METHOD.slice(index + 1)}` as Address;
})();

export const OTHER_METHOD: Address = '0x9999999999999999999999999999999999999999';

export const ZERO: Address = '0x0000000000000000000000000000000000000000';

/** One recorded call on a method double: the member's name and its arguments. */
export type MethodCall = { readonly member: string; readonly args: readonly unknown[] };

/** What each member of a recording double answers; a function receives the call's arguments. */
export type Answers = {
  readonly signingInput?: (ctx: Ctx, params?: Params) => Input;
  readonly replyFrom?: (ctx: Ctx, input: Input, material: Material) => Promise<Hex | ReplyFailure>;
  readonly verify?: (ctx: Ctx, proof: Hex) => Promise<Verdict>;
  readonly enrollInput?: (params: Params) => EnrollInput;
  readonly configFrom?: (input: EnrollInput, material: Material) => Promise<Hex | EnrollFailure>;
};

export const FACTS: DeviceFacts = { kind: 'typed-data-wallet', double: true };

export const PROOF: Hex = '0xc0ffee';

export const CONFIG: Hex = '0x1234';

/** A method double that records every call and answers fixed, well-shaped values unless told otherwise. */
export function recordingMethod(
  binding: DeviceBinding = 'none',
  answers: Answers = {},
): { readonly method: IRecoveryMethod; readonly calls: MethodCall[] } {
  const calls: MethodCall[] = [];
  const record = (member: string, args: readonly unknown[]): void => {
    calls.push({ member, args });
  };
  const refuse = (): never => {
    throw new Error('codec is not expected');
  };
  const method: IRecoveryMethod = {
    modules: (...args) => {
      record('modules', args);

      return [];
    },
    enrollInput: (params) => {
      record('enrollInput', [params]);

      return answers.enrollInput?.(params) ?? { kind: 'nothing-to-perform', echoed: params };
    },
    configFrom: async (input, material) => {
      record('configFrom', [input, material]);

      return answers.configFrom === undefined ? CONFIG : answers.configFrom(input, material);
    },
    signingInput: (ctx, params) => {
      record('signingInput', [ctx, params]);

      return answers.signingInput?.(ctx, params) ?? { digest: ctx.digest };
    },
    replyFrom: async (ctx, input, material) => {
      record('replyFrom', [ctx, input, material]);

      return answers.replyFrom === undefined ? PROOF : answers.replyFrom(ctx, input, material);
    },
    verify: async (ctx, proof) => {
      record('verify', [ctx, proof]);

      return answers.verify === undefined ? 'satisfied' : answers.verify(ctx, proof);
    },
    codec: { encodeConfig: refuse, decodeConfig: refuse, encodeProof: refuse, decodeProof: refuse },
    deviceBinding: binding,
    describe: (ctx) => {
      record('describe', [ctx]);

      return FACTS;
    },
    vector: [],
  };

  return { method, calls };
}

/** The calls a double received on one member. */
export const callsTo = (calls: readonly MethodCall[], member: string): MethodCall[] => calls.filter((call) => call.member === member);

/** The ctx handed to the first call on a member; throws when there was none. */
export function ctxOf(calls: readonly MethodCall[], member: string): Ctx {
  const call = callsTo(calls, member)[0];

  if (call === undefined) throw new Error(`no call to ${member}`);

  return call.args[0] as Ctx;
}

/** Every device binding, the runtime that meets them all. */
export const ALL_BINDINGS: readonly DeviceBinding[] = DEVICE_BINDINGS;

/** An orchestrator over the given method entries, the blessed request's action served by an honest codec. */
export function orchestratorOver(
  entries: readonly (readonly [Address, IRecoveryMethod])[],
  bindings: readonly DeviceBinding[] = ALL_BINDINGS,
  codecs: ActionCodecRegistry = codecsFor(approvalFromVector().action),
): MethodsOrchestrator {
  const methods: MethodRegistry = new Map(entries);

  return new MethodsOrchestrator(methods, codecs, bindings);
}

/** A codec registry serving one action with the honest two-address codec. */
export const codecsFor = (action: Address): ActionCodecRegistry => new Map<Address, IActionCodec>([[action, strictCodec([action])]]);

/** The blessed approval request, optionally with some members replaced. */
export const approval = (overrides: Record<string, unknown> = {}): ApproverRequest =>
  ({ ...approvalFromVector(), ...overrides }) as ApproverRequest;

/** The blessed cancellation request, optionally with some members replaced. */
export const cancellation = (overrides: Record<string, unknown> = {}): ApproverRequest =>
  ({ ...cancellationFromVector(), ...overrides }) as ApproverRequest;

/** The error a call throws, or undefined when it returns. */
export function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }

  return undefined;
}

/** The error a promise rejects with, or undefined when it resolves. */
export async function rejectionOf(promise: () => Promise<unknown>): Promise<unknown> {
  try {
    await promise();
  } catch (error) {
    return error;
  }

  return undefined;
}

/** Whether an error is a malformed-argument error, either class. */
export const isArgumentError = (error: unknown): boolean => error instanceof TypeError || error instanceof RangeError;
