import type {
  ActionState,
  Address,
  AttemptRequest,
  CancelRequest,
  Domain,
  Hex,
  ModuleInfo,
  Parties,
  PreparedCall,
  ReadResult,
} from './records';

/**
 * The shared part for the manager, bound to the account and the action
 * (D-201, D-202). Its writes are the six prepares the manager's own functions
 * name, each taking the contract's own argument list; its reads are the
 * manager's views and the three method module views. `PolicyManager` is the
 * shipped implementation.
 */
export interface IPolicyManagerInteractor {
  prepareCommitSetup(
    action: Address,
    setupCommitment: Hex,
    nonce: bigint,
    publicMetadata: Hex,
    privateMetadata: Hex,
  ): Promise<PreparedCall>;
  prepareClearSetup(action: Address): Promise<PreparedCall>;
  prepareCancelByOwner(action: Address): Promise<PreparedCall>;
  prepareStartAttempt(request: AttemptRequest): Promise<PreparedCall>;
  prepareCancelByProofs(request: CancelRequest): Promise<PreparedCall>;
  prepareCancelByVeto(account: Address, action: Address, attemptId: bigint, method: Address): Promise<PreparedCall>;
  stateOf(): Promise<ActionState>;
  hashApproval(request: AttemptRequest, place: number): Promise<Hex>;
  hashCancel(request: CancelRequest, place: number): Promise<Hex>;
  eip712Domain(): Promise<Domain>;
  name(): Promise<string>;
  version(): Promise<string>;
  supportsInterface(interfaceId: Hex): Promise<boolean>;
  /** Whether the read was answered at all, beside what it answered. */
  moduleInfo(module: Address): Promise<ReadResult<ModuleInfo>>;
  /** Whether the read was answered at all, beside the two-valued stop reading. */
  paused(module: Address): Promise<ReadResult<boolean>>;
  /** Whether the read was answered at all, beside the five declared values. */
  trustedParties(module: Address): Promise<ReadResult<Parties>>;
}
