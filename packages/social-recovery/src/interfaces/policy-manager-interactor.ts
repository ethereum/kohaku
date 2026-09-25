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

/** The policy manager's writes as prepared calls and its views as reads, bound to one account and one action. */
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
  moduleInfo(module: Address): Promise<ReadResult<ModuleInfo>>;
  paused(module: Address): Promise<ReadResult<boolean>>;
  trustedParties(module: Address): Promise<ReadResult<Parties>>;
}
