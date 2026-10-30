import { encodeFunctionData } from 'viem';
import {
  POLICY_ACTION_INTERFACE_ID,
  RECOVERY_ACTION_DISARMED_VALUE,
  RECOVERY_ACTION_READ_FROM,
  RECOVERY_ACTION_SET_ADDR_PRIVILEGE_ABI,
  RECOVERY_ACTION_VIEWS_ABI,
} from '../constants';
import { assertArray, assertBytes32, assertObject, checkedBlock, lowerHex, normalizeAddress, sameAddress } from '../formats/guards';
import { kitBinding, kitSlot } from '../formats/kit';
import {
  isProviderRevert,
  NAMED_BLOCK_TAGS,
  type ActionInfo,
  type Address,
  type BlockTags,
  type DeploymentDescriptor,
  type Hex,
  type IActionCodec,
  type IProvider,
  type IRecoveryActionArming,
  type IRecoveryActionInteractor,
  type PinnedBlock,
  type PreparedCall,
} from '../interfaces';
import { boolReturn, stringReturn } from './returns';

/**
 * The Ambire recovery action's part, bound to one account and one action; each member reads or pins at the passed block, else at the read tag's.
 * A passed block is used as given: reads pin by its number and a prepare reports its hash unverified.
 */
export class AmbireRecoveryAction implements IRecoveryActionInteractor, IRecoveryActionArming {
  private readonly provider: IProvider;
  private readonly descriptor: DeploymentDescriptor;
  private readonly account: Address;
  private readonly action: Address;
  private readonly codec: IActionCodec;
  private readonly blockTags: BlockTags;
  private readonly slot: Address;
  private readonly binding: Hex;

  /** Throws where the action is not one the codec serves. */
  constructor(
    provider: IProvider,
    descriptor: DeploymentDescriptor,
    account: Address,
    action: Address,
    codec: IActionCodec,
    blockTags: BlockTags,
  ) {
    assertObject(provider, 'provider');
    assertObject(descriptor, 'descriptor');
    assertObject(codec, 'codec');
    assertArray(codec.actions, 'codec.actions');
    assertObject(blockTags, 'blockTags');

    if (!NAMED_BLOCK_TAGS.includes(blockTags.read)) throw new TypeError('blockTags.read must be a named block tag');

    this.provider = provider;
    this.descriptor = descriptor;
    this.account = normalizeAddress(account, 'account');
    this.action = normalizeAddress(action, 'action');
    this.codec = codec;
    this.blockTags = blockTags;

    const served = codec.actions.map((entry, index) => normalizeAddress(entry, `codec.actions[${index}]`));

    if (!served.some((entry) => sameAddress(entry, this.action))) {
      throw new RangeError(`action ${this.action} is not one the codec serves`);
    }

    this.slot = kitSlot(this.action);
    this.binding = kitBinding(this.action);
  }

  /** The action's `supportsAccount` over the bound account. */
  async supportsAccount(block?: PinnedBlock): Promise<boolean> {
    const at = await this.blockNumber(block);
    const data = encodeFunctionData({ abi: RECOVERY_ACTION_VIEWS_ABI, functionName: 'supportsAccount', args: [this.account] });

    return boolReturn(await this.read(data, at), 'supportsAccount');
  }

  /** The action's `isAuthority` for one key over the bound account. */
  async isAuthority(key: Address, block?: PinnedBlock): Promise<boolean> {
    const authority = normalizeAddress(key, 'key');
    const at = await this.blockNumber(block);
    const data = encodeFunctionData({ abi: RECOVERY_ACTION_VIEWS_ABI, functionName: 'isAuthority', args: [this.account, authority] });

    return boolReturn(await this.read(data, at), 'isAuthority');
  }

  /** The action's `isAuthorized` over the bound account. */
  async isAuthorized(block?: PinnedBlock): Promise<boolean> {
    const at = await this.blockNumber(block);
    const data = encodeFunctionData({ abi: RECOVERY_ACTION_VIEWS_ABI, functionName: 'isAuthorized', args: [this.account] });

    return boolReturn(await this.read(data, at), 'isAuthorized');
  }

  /** The action's `holdsAnyPrivilege` for one candidate over the bound account. */
  async holdsAnyPrivilege(candidate: Address, block?: PinnedBlock): Promise<boolean> {
    const address = normalizeAddress(candidate, 'candidate');
    const at = await this.blockNumber(block);
    const data = encodeFunctionData({
      abi: RECOVERY_ACTION_VIEWS_ABI,
      functionName: 'holdsAnyPrivilege',
      args: [this.account, address],
    });

    return boolReturn(await this.read(data, at), 'holdsAnyPrivilege');
  }

  /** The action's name, version and policy-action probe at one block; a reverted or malformed probe answers false. */
  async actionInfo(block?: PinnedBlock): Promise<ActionInfo> {
    const at = await this.blockNumber(block);
    const nameData = encodeFunctionData({ abi: RECOVERY_ACTION_VIEWS_ABI, functionName: 'name' });
    const versionData = encodeFunctionData({ abi: RECOVERY_ACTION_VIEWS_ABI, functionName: 'version' });
    const [name, version, supportsInterface] = await Promise.all([
      this.read(nameData, at).then((returned) => stringReturn(returned, 'name')),
      this.read(versionData, at).then((returned) => stringReturn(returned, 'version')),
      this.probe(at),
    ]);

    return { name, version, supportsInterface };
  }

  /** The account's own `setAddrPrivilege(KIT_SLOT, value)` for the bound action, sent by the account. */
  async prepareSetAddrPrivilege(value: Hex, block?: PinnedBlock): Promise<PreparedCall> {
    assertBytes32(value, 'value');

    const pinned = await this.pinned(block);

    const data = encodeFunctionData({
      abi: RECOVERY_ACTION_SET_ADDR_PRIVILEGE_ABI,
      functionName: 'setAddrPrivilege',
      args: [this.slot, lowerHex(value)],
    });

    return { kind: 'call', target: this.account, value: 0n, data, sender: 'account', block: pinned };
  }

  /** Writes the action's binding under its kit slot. */
  armingCall(block?: PinnedBlock): Promise<PreparedCall> {
    return this.prepareSetAddrPrivilege(this.binding, block);
  }

  /** Writes zero under the action's kit slot. */
  disarmingCall(block?: PinnedBlock): Promise<PreparedCall> {
    return this.prepareSetAddrPrivilege(RECOVERY_ACTION_DISARMED_VALUE, block);
  }

  /** The passed block checked, or the read tag resolved to one block where none is passed. */
  private async pinned(block: PinnedBlock | undefined): Promise<PinnedBlock> {
    if (block !== undefined) return checkedBlock(block, 'block');

    return checkedBlock(await this.provider.block(this.blockTags.read), 'block header');
  }

  /** The number of the block a read runs at. */
  private async blockNumber(block: PinnedBlock | undefined): Promise<number> {
    return (await this.pinned(block)).number;
  }

  /** One view call to the action at a block; a revert rejects as the provider's. */
  private read(data: Hex, block: number): Promise<Hex> {
    return this.provider.call(this.action, data, RECOVERY_ACTION_READ_FROM, block);
  }

  /** The policy-action probe, false where it reverts or answers malformed bytes. */
  private async probe(block: number): Promise<boolean> {
    const data = encodeFunctionData({
      abi: RECOVERY_ACTION_VIEWS_ABI,
      functionName: 'supportsInterface',
      args: [POLICY_ACTION_INTERFACE_ID],
    });
    let returned: Hex;

    try {
      returned = await this.read(data, block);
    } catch (thrown) {
      if (isProviderRevert(thrown)) return false;

      throw thrown;
    }

    try {
      return boolReturn(returned, 'supportsInterface');
    } catch {
      return false;
    }
  }
}
