import type {
  ActionState,
  Address,
  AttemptRequest,
  CancelRequest,
  Domain,
  Hex,
  ModuleInfo,
  Parties,
  PinnedBlock,
  PreparedCall,
  ReadResult,
} from './records';

/**
 * The policy manager's writes as prepared calls and its views as reads, bound to one account and one action.
 * The optional last `block` pins a member to that block instead of the read tag's.
 * A passed block is used as given: reads pin by its number and a prepare reports its hash unverified.
 */
export interface IPolicyManagerInteractor {
  prepareCommitSetup(
    action: Address,
    setupCommitment: Hex,
    nonce: bigint,
    publicMetadata: Hex,
    privateMetadata: Hex,
    block?: PinnedBlock,
  ): Promise<PreparedCall>;
  /** `nonce` is the stored `setupNonce` the clear names, read from `stateOf`. */
  prepareClearSetup(action: Address, nonce: bigint, block?: PinnedBlock): Promise<PreparedCall>;
  /** `attemptId` is the waiting attempt's, read from `stateOf`. */
  prepareCancelByOwner(action: Address, attemptId: bigint, block?: PinnedBlock): Promise<PreparedCall>;
  prepareStartAttempt(request: AttemptRequest, block?: PinnedBlock): Promise<PreparedCall>;
  prepareCancelByProofs(request: CancelRequest, block?: PinnedBlock): Promise<PreparedCall>;
  prepareCancelByVeto(
    account: Address,
    action: Address,
    attemptId: bigint,
    method: Address,
    block?: PinnedBlock,
  ): Promise<PreparedCall>;
  stateOf(block?: PinnedBlock): Promise<ActionState>;
  hashApproval(request: AttemptRequest, place: number, block?: PinnedBlock): Promise<Hex>;
  hashCancel(request: CancelRequest, place: number, block?: PinnedBlock): Promise<Hex>;
  eip712Domain(block?: PinnedBlock): Promise<Domain>;
  name(block?: PinnedBlock): Promise<string>;
  version(block?: PinnedBlock): Promise<string>;
  supportsInterface(interfaceId: Hex, block?: PinnedBlock): Promise<boolean>;
  moduleInfo(module: Address, block?: PinnedBlock): Promise<ReadResult<ModuleInfo>>;
  paused(module: Address, block?: PinnedBlock): Promise<ReadResult<boolean>>;
  trustedParties(module: Address, block?: PinnedBlock): Promise<ReadResult<Parties>>;
}
