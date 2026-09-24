import type {
  Address,
  EnrollFailure,
  EnrollInput,
  Hex,
  Input,
  Material,
  Params,
  Reply,
  ReplyFailure,
  Request,
  RequestDescription,
  Verdict,
} from './records';

/**
 * The approving and enrolling side's entry, holding no provider and reading no
 * chain (D-201, D-206). `MethodsOrchestrator` is the shipped implementation.
 */
export interface IMethodsOrchestrator {
  describeRequest(request: Request): RequestDescription;
  /** The local verdict for one place; an answer, never a refusal. */
  verify(request: Request, place: number, proof: Hex): Promise<Verdict>;
  /** Throws when it refuses, before any device is asked. */
  signingInput(request: Request, params?: Params): Input;
  /** A refusal comes back as `ReplyFailure`, never as a thrown error. */
  replyFrom(request: Request, input: Input, material: Material): Promise<Reply | ReplyFailure>;
  /** Throws when it refuses. */
  enrollInput(method: Address, params: Params): EnrollInput;
  /** A refusal comes back as `EnrollFailure`, never as a thrown error. */
  configFrom(method: Address, input: EnrollInput, material: Material): Promise<Hex | EnrollFailure>;
}
