import { KitRefusalError } from '../client-core/refusal';
import {
  FORMATS_PLACE_BITS,
  METHODS_ORCHESTRATOR_DEVICE_UNAVAILABLE,
  METHODS_ORCHESTRATOR_METHOD_UNSUPPORTED,
  METHODS_ORCHESTRATOR_PLACE_MISMATCH_MESSAGE,
  METHODS_ORCHESTRATOR_REQUEST_UNSUPPORTED,
  METHODS_ORCHESTRATOR_UNBOUND,
  METHODS_ORCHESTRATOR_UNMET_BINDING_MESSAGE,
  METHODS_ORCHESTRATOR_UNSERVED_METHOD_MESSAGE,
} from '../constants';
import { checkedRequest, readRequest } from '../description/ctx';
import { describeRequest } from '../description/request';
import { assertBytes, assertObject, assertUintNumber, normalizeAddress } from '../formats/guards';
import {
  type Address,
  type ApproverRequest,
  type DeviceBinding,
  type EnrollFailure,
  type EnrollInput,
  type Hex,
  type IActionCodec,
  type IMethodsOrchestrator,
  type Input,
  type IRecoveryMethod,
  type Material,
  type Params,
  type Reply,
  type ReplyFailure,
  type RequestDescription,
  type Verdict,
} from '../interfaces';
import type { ActionCodecRegistry, MethodRegistry } from '../types';
import { checkedBytes, checkedEnrollInput, checkedInput, checkedVerdict, replyOf } from './answers';
import { checkedBindings, checkedCodecs, checkedMethods } from './registries';

/**
 * The approving and enrolling side's entry: it builds every ctx from the request alone, holds no provider and reads no chain.
 * Both registries and the device bindings this runtime meets are required, checked whole and copied at construction.
 */
export class MethodsOrchestrator implements IMethodsOrchestrator {
  readonly #methods: ReadonlyMap<Address, IRecoveryMethod>;

  readonly #codecs: ReadonlyMap<Address, IActionCodec>;

  readonly #bindings: ReadonlySet<DeviceBinding>;

  /** `bindings` names the device bindings this runtime meets; it is required, and `none` is met whether it is named or not. */
  constructor(methods: MethodRegistry, codecs: ActionCodecRegistry, bindings: readonly DeviceBinding[]) {
    this.#methods = checkedMethods(methods);
    this.#codecs = checkedCodecs(codecs);
    this.#bindings = checkedBindings(bindings);
  }

  /** The description an approver reads, one call over the describe utility with the two registries held. */
  describeRequest(request: ApproverRequest): RequestDescription {
    return describeRequest(request, this.#codecs, this.#methods);
  }

  /** The implementation's verdict for the request's own place; throws for a malformed proof, another place or a method no implementation serves. */
  async verify(request: ApproverRequest, place: number, proof: Hex): Promise<Verdict> {
    const { ctx } = checkedRequest(request);

    assertUintNumber(place, FORMATS_PLACE_BITS, 'place');

    if (place !== ctx.place) throw new RangeError(METHODS_ORCHESTRATOR_PLACE_MISMATCH_MESSAGE);

    assertBytes(proof, 'proof');

    const implementation = this.#served(ctx.request.method);

    return checkedVerdict(await implementation.verify(ctx, proof), 'verify');
  }

  /** The implementation's signing input; throws for a method no implementation serves or a binding this runtime cannot meet. */
  signingInput(request: ApproverRequest, params?: Params): Input {
    const { ctx } = checkedRequest(request);

    if (params !== undefined) assertObject(params, 'params');

    const implementation = this.#served(ctx.request.method);

    this.#assertMet(implementation);

    return checkedInput(implementation.signingInput(ctx, params), 'signingInput');
  }

  /** The reply carrying the implementation's proof, or a typed failure; a malformed argument still throws. */
  async replyFrom(request: ApproverRequest, input: Input, material: Material): Promise<Reply | ReplyFailure> {
    assertObject(request, 'request');
    assertObject(input, 'input');

    const read = readRequest(request);

    if ('unread' in read) return METHODS_ORCHESTRATOR_REQUEST_UNSUPPORTED;

    const { ctx } = read;
    const implementation = this.#methods.get(ctx.request.method);

    if (implementation === undefined) return METHODS_ORCHESTRATOR_METHOD_UNSUPPORTED;

    if (!this.#meets(implementation)) return METHODS_ORCHESTRATOR_DEVICE_UNAVAILABLE;

    const answer = checkedBytes(await implementation.replyFrom(ctx, input, material), 'replyFrom');

    return typeof answer === 'string' ? replyOf(ctx, answer) : answer;
  }

  /** The implementation's enrollment input; throws for a method no implementation serves or a binding this runtime cannot meet. */
  enrollInput(method: Address, params: Params): EnrollInput {
    const served = normalizeAddress(method, 'method');

    assertObject(params, 'params');

    const implementation = this.#served(served);

    this.#assertMet(implementation);

    return checkedEnrollInput(implementation.enrollInput(params), 'enrollInput');
  }

  /** The config bytes the implementation derives, or a typed failure; a malformed argument still throws. */
  async configFrom(method: Address, input: EnrollInput, material: Material): Promise<Hex | EnrollFailure> {
    const served = normalizeAddress(method, 'method');

    assertObject(input, 'input');

    const implementation = this.#methods.get(served);

    if (implementation === undefined) return METHODS_ORCHESTRATOR_METHOD_UNSUPPORTED;

    if (!this.#meets(implementation)) return METHODS_ORCHESTRATOR_DEVICE_UNAVAILABLE;

    return checkedBytes(await implementation.configFrom(input, material), 'configFrom');
  }

  /** The implementation serving the checksummed method address, throwing where none does. */
  #served(method: Address): IRecoveryMethod {
    const implementation = this.#methods.get(method);

    if (implementation === undefined) throw new KitRefusalError(`${METHODS_ORCHESTRATOR_UNSERVED_METHOD_MESSAGE} ${method}`);

    return implementation;
  }

  /** Whether this runtime meets the implementation's device binding; one that asks for no device is always met. */
  #meets(implementation: IRecoveryMethod): boolean {
    return implementation.deviceBinding === METHODS_ORCHESTRATOR_UNBOUND || this.#bindings.has(implementation.deviceBinding);
  }

  /** Throws where this runtime cannot meet the implementation's device binding, before any device is asked. */
  #assertMet(implementation: IRecoveryMethod): void {
    if (!this.#meets(implementation)) {
      throw new KitRefusalError(`${METHODS_ORCHESTRATOR_UNMET_BINDING_MESSAGE} ${implementation.deviceBinding}`);
    }
  }
}
