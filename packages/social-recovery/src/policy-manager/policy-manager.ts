import { encodeFunctionData, size } from 'viem';
import {
  POLICY_MANAGER_EIP712_DOMAIN_ABI,
  POLICY_MANAGER_HASH_APPROVAL_ABI,
  POLICY_MANAGER_HASH_CANCEL_ABI,
  POLICY_MANAGER_INTERFACE_ID_SIZE,
  POLICY_MANAGER_NAME_ABI,
  POLICY_MANAGER_STATE_OF_ABI,
  POLICY_MANAGER_SUPPORTS_INTERFACE_ABI,
  POLICY_MANAGER_VERSION_ABI,
} from '../constants';
import { encodeAttemptRequest, encodeCancelRequest } from '../formats';
import { assertBytes, assertObject, normalizeAddress } from '../formats/guards';
import {
  NAMED_BLOCK_TAGS,
  type ActionState,
  type Address,
  type AttemptRequest,
  type BlockTags,
  type CancelRequest,
  type DeploymentDescriptor,
  type Domain,
  type Hex,
  type IMethodModuleReads,
  type IPolicyManagerInteractor,
  type IProvider,
  type ModuleInfo,
  type NamedBlockTag,
  type Parties,
  type PinnedBlock,
  type PreparedCall,
  type ReadResult,
  type Sender,
} from '../interfaces';
import { assertBoundRequest, boundAddress, cancelByOwnerData, cancelByVetoData, clearSetupData, commitSetupData, hashApprovalData, hashCancelData } from './calldata';
import { decodeReturn, readCall, resolveBlock } from './chain';
import { readModuleInfo, readPaused, readTrustedParties } from './module-reads';
import { actionStateFrom, domainFrom } from './records';

/** Refuses a read tag that is not one of the named block tags. */
function checkReadTag(blockTags: BlockTags): NamedBlockTag {
  assertObject(blockTags, 'blockTags');

  if (!(NAMED_BLOCK_TAGS as readonly unknown[]).includes(blockTags.read)) {
    throw new TypeError(`blockTags.read must be one of ${NAMED_BLOCK_TAGS.join(', ')}`);
  }

  return blockTags.read;
}

/**
 * The shipped `IPolicyManagerInteractor`, bound to one manager, one account and one action.
 * Every read and every prepare pins to the block passed, or else reads the configured read tag's block once;
 * a prepare carries no simulation, and an argument naming another account or action throws a `TypeError`.
 * A passed block is used as given: reads pin by its number and a prepare reports its hash unverified.
 */
export class PolicyManager implements IPolicyManagerInteractor, IMethodModuleReads {
  private readonly provider: IProvider;
  private readonly manager: Address;
  private readonly account: Address;
  private readonly action: Address;
  private readonly readTag: NamedBlockTag;

  constructor(provider: IProvider, descriptor: DeploymentDescriptor, account: Address, action: Address, blockTags: BlockTags) {
    assertObject(provider, 'provider');
    assertObject(descriptor, 'descriptor');
    this.provider = provider;
    this.manager = normalizeAddress(descriptor.manager, 'descriptor.manager');
    this.account = normalizeAddress(account, 'account');
    this.action = normalizeAddress(action, 'action');
    this.readTag = checkReadTag(blockTags);
  }

  async prepareCommitSetup(
    action: Address,
    setupCommitment: Hex,
    nonce: bigint,
    publicMetadata: Hex,
    privateMetadata: Hex,
    block?: PinnedBlock,
  ): Promise<PreparedCall> {
    const bound = boundAddress(action, this.action, 'action', 'action');

    return this.prepared(commitSetupData(bound, setupCommitment, nonce, publicMetadata, privateMetadata), 'account', block);
  }

  async prepareClearSetup(action: Address, nonce: bigint, block?: PinnedBlock): Promise<PreparedCall> {
    const bound = boundAddress(action, this.action, 'action', 'action');

    return this.prepared(clearSetupData(bound, nonce), 'account', block);
  }

  async prepareCancelByOwner(action: Address, attemptId: bigint, block?: PinnedBlock): Promise<PreparedCall> {
    const bound = boundAddress(action, this.action, 'action', 'action');

    return this.prepared(cancelByOwnerData(bound, attemptId), 'account', block);
  }

  async prepareStartAttempt(request: AttemptRequest, block?: PinnedBlock): Promise<PreparedCall> {
    assertBoundRequest(request, this.account, this.action);

    return this.prepared(encodeAttemptRequest(request), 'anyone', block);
  }

  async prepareCancelByProofs(request: CancelRequest, block?: PinnedBlock): Promise<PreparedCall> {
    assertBoundRequest(request, this.account, this.action);

    return this.prepared(encodeCancelRequest(request), 'anyone', block);
  }

  async prepareCancelByVeto(account: Address, action: Address, attemptId: bigint, method: Address, block?: PinnedBlock): Promise<PreparedCall> {
    const boundAccount = boundAddress(account, this.account, 'account', 'account');
    const boundAction = boundAddress(action, this.action, 'action', 'action');

    return this.prepared(cancelByVetoData(boundAccount, boundAction, attemptId, method), 'anyone', block);
  }

  /** The bound pair's state; a revert rejects with the provider's `ProviderRevert`, a return that does not decode with a `TypeError`. */
  async stateOf(block?: PinnedBlock): Promise<ActionState> {
    const data = encodeFunctionData({ abi: POLICY_MANAGER_STATE_OF_ABI, args: [this.account, this.action] });

    return actionStateFrom(await this.read(data, block));
  }

  async hashApproval(request: AttemptRequest, place: number, block?: PinnedBlock): Promise<Hex> {
    assertBoundRequest(request, this.account, this.action);

    const returned = await this.read(hashApprovalData(request, place), block);
    const [digest] = decodeReturn(POLICY_MANAGER_HASH_APPROVAL_ABI[0].outputs, returned, 'hashApproval');

    return digest.toLowerCase() as Hex;
  }

  async hashCancel(request: CancelRequest, place: number, block?: PinnedBlock): Promise<Hex> {
    assertBoundRequest(request, this.account, this.action);

    const returned = await this.read(hashCancelData(request, place), block);
    const [digest] = decodeReturn(POLICY_MANAGER_HASH_CANCEL_ABI[0].outputs, returned, 'hashCancel');

    return digest.toLowerCase() as Hex;
  }

  async eip712Domain(block?: PinnedBlock): Promise<Domain> {
    return domainFrom(await this.read(encodeFunctionData({ abi: POLICY_MANAGER_EIP712_DOMAIN_ABI }), block));
  }

  async name(block?: PinnedBlock): Promise<string> {
    const returned = await this.read(encodeFunctionData({ abi: POLICY_MANAGER_NAME_ABI }), block);
    const [name] = decodeReturn(POLICY_MANAGER_NAME_ABI[0].outputs, returned, 'name');

    return name;
  }

  async version(block?: PinnedBlock): Promise<string> {
    const returned = await this.read(encodeFunctionData({ abi: POLICY_MANAGER_VERSION_ABI }), block);
    const [version] = decodeReturn(POLICY_MANAGER_VERSION_ABI[0].outputs, returned, 'version');

    return version;
  }

  async supportsInterface(interfaceId: Hex, block?: PinnedBlock): Promise<boolean> {
    assertBytes(interfaceId, 'interfaceId');

    if (size(interfaceId) !== POLICY_MANAGER_INTERFACE_ID_SIZE) {
      throw new TypeError(`interfaceId must be exactly ${POLICY_MANAGER_INTERFACE_ID_SIZE} bytes of 0x-prefixed hex`);
    }

    const data = encodeFunctionData({ abi: POLICY_MANAGER_SUPPORTS_INTERFACE_ABI, args: [interfaceId.toLowerCase() as Hex] });
    const returned = await this.read(data, block);
    const [supported] = decodeReturn(POLICY_MANAGER_SUPPORTS_INTERFACE_ABI[0].outputs, returned, 'supportsInterface');

    return supported;
  }

  moduleInfo(module: Address, block?: PinnedBlock): Promise<ReadResult<ModuleInfo>> {
    return readModuleInfo(this.provider, module, this.readTag, block);
  }

  paused(module: Address, block?: PinnedBlock): Promise<ReadResult<boolean>> {
    return readPaused(this.provider, module, this.readTag, block);
  }

  trustedParties(module: Address, block?: PinnedBlock): Promise<ReadResult<Parties>> {
    return readTrustedParties(this.provider, module, this.readTag, block);
  }

  /** A call to the manager from the given sender, pinned to the passed block or else the read tag's. */
  private async prepared(data: Hex, sender: Sender, block: PinnedBlock | undefined): Promise<PreparedCall> {
    const pinned = await resolveBlock(this.provider, this.readTag, block);

    return { kind: 'call', target: this.manager, value: 0n, data, sender, block: pinned };
  }

  /** One view call to the manager at the passed block, or else at the read tag's. */
  private async read(data: Hex, block: PinnedBlock | undefined): Promise<Hex> {
    return readCall(this.provider, this.manager, data, await resolveBlock(this.provider, this.readTag, block));
  }
}
