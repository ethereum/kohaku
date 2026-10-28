/* eslint-disable max-lines */
import { pinBlockHeader, simulatePrepared } from '../client-core';
import { assertBool, assertBytes, normalizeAddress } from '../formats/guards';
import { count, fileReply, order, requests, seed } from '../gathering';
import type {
  AddResult,
  Address,
  ApproverRequest,
  Assessment,
  Attempt,
  AttemptRequest,
  CancelRequest,
  ClientConfiguration,
  ConfigurationSource,
  DeploymentDescriptor,
  Gathering,
  Handover,
  Hex,
  IActionCodec,
  IEventManager,
  IPolicyManagerInteractor,
  IProvider,
  IRecoveryActionInteractor,
  IRecoveryClient,
  ISignerRecovery,
  Moment,
  PaymentOrder,
  PreparedCall,
  PrepareOptions,
  RecoveryState,
  Reply,
  Selection,
  ValidityWindow,
} from '../interfaces';
import { assertOptions, assertPreparesServed } from '../setup-client/check';
import type { MethodRegistry } from '../types';
import type { RecoveryClientParts } from '../types/recovery-client';
import { assertSource, cancellingWindow, checkedHandover, serializedOrder, windowEnd, windowWidth } from './arguments';
import { assertCompletable, requestOf } from './completion';
import { describedBatch, executeCall } from './described';
import { assertPayloadHash, assertSameAttempt, assertSpendNotVetoed, checkedAttempt, decodedHandover, payeeOf, payloadHashOf } from './execute';
import { namedHandover } from './handover';
import { assertAttemptState, assertAttemptWaiting, assertNoAttemptWaiting, gatheredSetup, readState } from './reading';
import { sharedRequest } from './record';
import { checkedParts } from './parts';
import { recoveryRecord, removedKeyAt } from './state';
import { assertPayloadDecodes, assertSubmission } from './submission';

/**
 * The entry an integrator builds when a key is lost, bound to one chain, deployment, account and action.
 * Each member that reads pins one block at the read tag and reads everything behind it at that block; the gathering members
 * read nothing. It holds no state between calls. With `versionEscaped` set, every prepare refuses and the rest keeps working.
 */
export class RecoveryClient implements IRecoveryClient {
  /** The event manager shared with the setup client. */
  readonly events: IEventManager;
  private readonly parts: RecoveryClientParts;
  private readonly versionEscaped: boolean;

  /** Throws a `TypeError` on a malformed part, address or flag and a `RangeError` where the codec does not serve the action. */
  constructor(
    provider: IProvider,
    descriptor: DeploymentDescriptor,
    account: Address,
    action: Address,
    configuration: ClientConfiguration,
    policyManager: IPolicyManagerInteractor,
    recoveryAction: IRecoveryActionInteractor,
    events: IEventManager,
    methods: MethodRegistry,
    codec: IActionCodec,
    signerRecovery?: ISignerRecovery,
    versionEscaped = false,
  ) {
    assertBool(versionEscaped, 'versionEscaped');
    this.parts = checkedParts({
      provider,
      descriptor,
      account,
      action,
      configuration,
      policyManager,
      recoveryAction,
      events,
      methods,
      codec,
      signerRecovery,
    });
    this.events = this.parts.events;
    this.versionEscaped = versionEscaped;
  }

  /**
   * The approval gathering for a handover, its payload encoded through the codec and its deadline the pinned block's
   * timestamp plus the window. Throws a `TypeError` or `RangeError` before any read on a malformed handover, order, window,
   * password or a source that is not an object; a malformed configuration source is refused by the restore after the block
   * pin and `stateOf`. Throws a `KitRefusalError` while an attempt is waiting, on a restore cause or on a handover the action
   * would refuse.
   */
  async initRecoveryGathering(
    source: ConfigurationSource,
    handover: Handover,
    order: PaymentOrder,
    window: ValidityWindow,
  ): Promise<Gathering> {
    const { parts } = this;
    const given = checkedHandover(handover);
    const storedOrder = serializedOrder(order);
    const width = windowWidth(window);

    assertSource(source);

    const reading = await readState(parts);

    assertNoAttemptWaiting(reading.state);

    const validUntil = windowEnd(reading.pinned.header.timestamp, width);
    const setup = await gatheredSetup(parts, source, reading);
    const named = await namedHandover(parts, given, reading.pinned.block);
    const request = sharedRequest(parts, reading, setup, reading.state.nextAttemptId, reading.state.setupNonce, validUntil);

    return seed({ purpose: 'approval', request: { ...request, payload: parts.codec.encode(named), order: storedOrder } }, setup.places);
  }

  /**
   * The cancellation gathering for the attempt waiting, its `consumableAfter` copied from the manager.
   * Throws a `TypeError` or `RangeError` before any read on a malformed window, one longer than the configured cancel window,
   * a malformed password or a source that is not an object; a malformed configuration source is refused by the restore after
   * the block pin and `stateOf`. Throws a `KitRefusalError` while no attempt is waiting or on a restore cause.
   */
  async initCancelGathering(source: ConfigurationSource, window: ValidityWindow): Promise<Gathering> {
    const { parts } = this;
    const width = cancellingWindow(window, parts.configuration);

    assertSource(source);

    const reading = await readState(parts);
    const { attempt, setupNonce } = reading.state;

    assertAttemptWaiting(reading.state, parts);

    const validUntil = windowEnd(reading.pinned.header.timestamp, width);
    const setup = await gatheredSetup(parts, source, reading);
    const request = sharedRequest(parts, reading, setup, attempt.attemptId, setupNonce, validUntil);

    return seed({ purpose: 'cancellation', request: { ...request, consumableAfter: String(attempt.consumableAfter) } }, setup.places);
  }

  /** One request per place for the approvers to sign, read off the record alone. */
  getApproverRequests(gathering: Gathering): readonly ApproverRequest[] {
    return requests(gathering);
  }

  /** A new record with the reply filed, or the typed refusal; it never throws on a refusal and never changes the record passed. */
  addApproverReply(gathering: Gathering, reply: Reply): AddResult {
    return fileReply(gathering, reply);
  }

  /** The record's progress at `now`, its window judged against the configured request window. */
  assess(gathering: Gathering, now: Moment): Assessment {
    return count(gathering, now, this.parts.configuration.requestWindow);
  }

  /**
   * The submission the record's members make with the chosen proofs, strictly increasing by place: the selection where one is
   * given, taken as given, otherwise the preferred satisfying set. The places chosen are the request's proof places; the
   * record's other filed places are the ones left out. Throws a `KitRefusalError` with the findings where the window has
   * passed at `now` or the rule is unsatisfied, and a `RangeError` where the selection names a place no reply fills.
   */
  complete(gathering: Gathering, selection: Selection | undefined, now: Moment): AttemptRequest | CancelRequest {
    assertCompletable(gathering, selection, now);

    const proofs = order(gathering, selection, now);

    return requestOf(gathering, proofs);
  }

  /**
   * The manager's `startAttempt(request)` at one pinned block, sent by anyone and simulated unless the options or the
   * configuration say otherwise, from `options.from` or the zero address. It runs no request validation: the integrator
   * judges the request with `validateRequest` first. Throws a `TypeError` or `RangeError` before any read on a malformed
   * argument or a request naming another account or action, and a `KitRefusalError` on a payload the codec does not decode.
   */
  async prepareStartAttempt(request: AttemptRequest, now: Moment, options?: PrepareOptions): Promise<PreparedCall> {
    const { parts } = this;

    assertPreparesServed(this.versionEscaped);
    assertSubmission(parts, request, true, now);
    assertOptions(options);
    assertPayloadDecodes(parts, request.payload);

    const { block } = await pinBlockHeader(parts.provider, parts.configuration.blockTags.read);
    const call = await parts.policyManager.prepareStartAttempt(request, block);

    return await simulatePrepared(parts.provider, call, parts.account, parts.configuration, options);
  }

  /**
   * The manager's `cancelByProofs(request)` at one pinned block, sent by anyone and simulated as the opening call is. It runs
   * no request validation: the integrator judges the request with `validateRequest` first. Throws a `TypeError` or
   * `RangeError` before any read on a malformed argument or a request naming another account or action.
   */
  async prepareCancelByProofs(request: CancelRequest, now: Moment, options?: PrepareOptions): Promise<PreparedCall> {
    const { parts } = this;

    assertPreparesServed(this.versionEscaped);
    assertSubmission(parts, request, false, now);
    assertOptions(options);

    const { block } = await pinBlockHeader(parts.provider, parts.configuration.blockTags.read);
    const call = await parts.policyManager.prepareCancelByProofs(request, block);

    return await simulatePrepared(parts.provider, call, parts.account, parts.configuration, options);
  }

  /**
   * The manager's `cancelByOwner(action, attemptId)` over the waiting attempt's id read at one pinned block, sent by the
   * account and simulated from it unless the configuration says otherwise. Throws a `KitRefusalError` while no attempt is
   * waiting.
   */
  async prepareCancelByOwner(): Promise<PreparedCall> {
    const { parts } = this;

    assertPreparesServed(this.versionEscaped);

    const reading = await readState(parts);
    const { attempt } = reading.state;

    assertAttemptWaiting(reading.state, parts);

    const call = await parts.policyManager.prepareCancelByOwner(parts.action, attempt.attemptId, reading.pinned.block);

    return await simulatePrepared(parts.provider, call, parts.account, parts.configuration);
  }

  /**
   * The manager's `cancelByVeto(account, action, attemptId, method)` over the waiting attempt's id read at one pinned block,
   * sent by anyone and simulated from `options.from` or the zero address, carrying no proofs; whether the method may veto
   * shows in the simulation. Throws a `TypeError` before any read on a malformed method or options, and a `KitRefusalError`
   * while no attempt is waiting.
   */
  async prepareCancelByVeto(method: Address, options?: PrepareOptions): Promise<PreparedCall> {
    const { parts } = this;

    assertPreparesServed(this.versionEscaped);

    const vetoing = normalizeAddress(method, 'method');

    assertOptions(options);

    const reading = await readState(parts);
    const { attempt } = reading.state;

    assertAttemptWaiting(reading.state, parts);

    const call = await parts.policyManager.prepareCancelByVeto(parts.account, parts.action, attempt.attemptId, vetoing, reading.pinned.block);

    return await simulatePrepared(parts.provider, call, parts.account, parts.configuration, options);
  }

  /**
   * The action's `executeHandover(account, payload)` at one pinned block, sent by anyone and simulated from `options.from` or
   * the zero address, describing the batch the action runs on the account; it reads no balance. Throws a `TypeError` or
   * `RangeError` before any read on a malformed argument, and a `TypeError` where the order pays an open payee and no
   * `options.from` names the sender. Throws a `KitRefusalError` on a payload that does not hold a well-formed handover, one
   * that does not hash to the attempt's payload hash, an attempt that is not the manager's, and a stopped method the attempt
   * used unless it ignores stops; an unanswered stop read rejects with an `Error`.
   */
  async prepareExecuteHandover(attempt: Attempt, payload: Hex, options?: PrepareOptions): Promise<PreparedCall> {
    const { parts } = this;

    assertPreparesServed(this.versionEscaped);

    const given = checkedAttempt(attempt);

    assertBytes(payload, 'payload');
    assertOptions(options);

    const payee = payeeOf(given, options);
    const handover = decodedHandover(parts, payload);
    const payloadHash = payloadHashOf(payload);

    assertPayloadHash(given, payloadHash);

    const reading = await readState(parts);
    const { block } = reading.pinned;
    const held = checkedAttempt(reading.state.attempt);

    assertSameAttempt(given, held);
    await assertSpendNotVetoed(parts, held, block);

    const describes = describedBatch(parts, given, handover, payloadHash, payee);
    const call = executeCall(parts, payload, block, describes);

    return await simulatePrepared(parts.provider, call, parts.account, parts.configuration, options);
  }

  /**
   * The manager's state for the account and action at one pinned block, with the key a handover would remove inferred at
   * that block from the events, the action and the signer seam where one was given; it reads no stop. Throws a `TypeError`
   * where the manager answers a malformed attempt.
   */
  async recoveryState(): Promise<RecoveryState> {
    const { parts } = this;
    const pinned = await pinBlockHeader(parts.provider, parts.configuration.blockTags.read);
    const [state, removedKey] = await Promise.all([parts.policyManager.stateOf(pinned.block), removedKeyAt(parts, pinned.block)]);

    assertAttemptState(state);

    const attempt = checkedAttempt(state.attempt);

    return recoveryRecord(state, attempt, removedKey, pinned.header);
  }
}
