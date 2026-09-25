import type {
  Address,
  ApproverRequest,
  EnrollFailure,
  EnrollInput,
  Hex,
  Input,
  Material,
  Params,
  Reply,
  ReplyFailure,
  RequestDescription,
  Verdict,
} from './records';

/** The approving and enrolling side's entry; it holds no provider and reads no chain. */
export interface IMethodsOrchestrator {
  describeRequest(request: ApproverRequest): RequestDescription;
  /** The local verdict for one place; an answer, never a refusal. */
  verify(request: ApproverRequest, place: number, proof: Hex): Promise<Verdict>;
  /** Throws when it refuses, before any device is asked. */
  signingInput(request: ApproverRequest, params?: Params): Input;
  /** A refusal comes back as `ReplyFailure`, never as a thrown error. */
  replyFrom(request: ApproverRequest, input: Input, material: Material): Promise<Reply | ReplyFailure>;
  /** Throws when it refuses. */
  enrollInput(method: Address, params: Params): EnrollInput;
  /** A refusal comes back as `EnrollFailure`, never as a thrown error. */
  configFrom(method: Address, input: EnrollInput, material: Material): Promise<Hex | EnrollFailure>;
}
