import type { IEventManager } from './event-manager';
import type {
  AddResult,
  Address,
  Assessment,
  Attempt,
  AttemptRequest,
  CancelRequest,
  ConfigurationSource,
  Gathering,
  Handover,
  Hex,
  Moment,
  PaymentOrder,
  PreparedCall,
  PrepareOptions,
  RecoveryState,
  Reply,
  Request,
  Selection,
  ValidityWindow,
} from './records';

/**
 * The entry built when a key is lost, bound to one chain, one deployment, one
 * account and one action (D-201, D-202, D-207). `RecoveryClient` is the shipped
 * implementation.
 */
export interface IRecoveryClient {
  /** Throws when it refuses. */
  initRecoveryGathering(
    source: ConfigurationSource,
    handover: Handover,
    order: PaymentOrder,
    window: ValidityWindow,
  ): Promise<Gathering>;
  /** Throws when it refuses. */
  initCancelGathering(source: ConfigurationSource, window: ValidityWindow): Promise<Gathering>;
  getApproverRequests(gathering: Gathering): readonly Request[];
  /** A refusal comes back as the typed result, never as a thrown error. */
  addApproverReply(gathering: Gathering, reply: Reply): AddResult;
  assess(gathering: Gathering, now: Moment): Assessment;
  /** `selection` undefined leaves the choice of places to the SDK; throws when it refuses. */
  complete(gathering: Gathering, selection: Selection | undefined, now: Moment): AttemptRequest | CancelRequest;
  /** Throws when it refuses. */
  prepareStartAttempt(request: AttemptRequest, now: Moment, options?: PrepareOptions): Promise<PreparedCall>;
  /** Throws when it refuses. */
  prepareCancelByProofs(request: CancelRequest, now: Moment, options?: PrepareOptions): Promise<PreparedCall>;
  prepareCancelByOwner(): Promise<PreparedCall>;
  /** Throws when it refuses. */
  prepareCancelByVeto(method: Address, options?: PrepareOptions): Promise<PreparedCall>;
  /** Throws when it refuses. */
  prepareExecuteHandover(attempt: Attempt, payload: Hex, options?: PrepareOptions): Promise<PreparedCall>;
  recoveryState(): Promise<RecoveryState>;
  /** The event manager shared with the setup client. */
  readonly events: IEventManager;
}
