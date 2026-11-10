import { encodeFunctionData } from 'viem';
import { pinBlockHeader } from '../client-core';
import { RECOVERY_ACTION_FALLBACK_HANDLER_SLOT, RECOVERY_ACTION_PRIVILEGES_ABI, RECOVERY_ACTION_READ_FROM } from '../constants';
import { assertBytes, assertDependency, lowerHex, sameAddress } from '../formats/guards';
import {
  METHOD_TIERS,
  type ActionInfo,
  type Address,
  type Hex,
  type IMethodCodec,
  type IRecoveryMethod,
  type KitNotification,
  type MethodTier,
  type PinnedBlock,
  type ReadResult,
} from '../interfaces';
import { actionManagerAt } from '../recovery-action/manager-read';
import { wordReturn } from '../recovery-action/returns';
import type { PinnedHeader } from '../types/client-core';
import type { JudgmentReads, SetupClientParts } from '../types/setup-client';
import type { ActionReads, MethodReads } from '../types/validation';

/** The block the read tag names at this moment, read once. */
export const pinRead = (parts: SetupClientParts): Promise<PinnedHeader> =>
  pinBlockHeader(parts.provider, parts.configuration.blockTags.read);

/** The registered implementation serving the module, if any. */
function implementationOf(parts: SetupClientParts, module: Address): IRecoveryMethod | undefined {
  for (const key of parts.methods.keys()) {
    if (sameAddress(key, module)) return parts.methods.get(key);
  }

  return undefined;
}

/** The tier the implementation states, where it states one of the tiers. */
function tierOf(implementation: IRecoveryMethod | undefined): MethodTier | undefined {
  const tier = implementation?.tier;

  return tier !== undefined && METHOD_TIERS.includes(tier) ? tier : undefined;
}

/** The registered implementation's codec to judge configs with, refusing one without a `decodeConfig` function. */
function codecOf(implementation: IRecoveryMethod | undefined, module: Address): Pick<IMethodCodec, 'decodeConfig'> | undefined {
  if (implementation === undefined) return undefined;

  const { codec } = implementation;

  assertDependency(codec, ['decodeConfig'], `methods.get(${module}).codec`);

  return codec;
}

/** One method module's reads at the block, beside whether this build serves it, the tier it states and its config decoder, refusing a registered codec without one. */
async function methodReads(parts: SetupClientParts, module: Address, block: PinnedBlock): Promise<MethodReads> {
  const [moduleInfo, trustedParties, paused] = await Promise.all([
    parts.policyManager.moduleInfo(module, block),
    parts.policyManager.trustedParties(module, block),
    parts.policyManager.paused(module, block),
  ]);
  const implementation = implementationOf(parts, module);
  const tier = tierOf(implementation);
  const codec = codecOf(implementation, module);

  return {
    module,
    moduleInfo,
    trustedParties,
    paused,
    implemented: implementation !== undefined,
    ...(tier === undefined ? {} : { tier }),
    ...(codec === undefined ? {} : { codec }),
  };
}

/** The action's identity at the block; any rejection, a revert, an undecodable answer or a failed transport, reads as unanswered. */
async function actionInfoRead(parts: SetupClientParts, block: PinnedBlock): Promise<ReadResult<ActionInfo>> {
  try {
    return { answered: true, value: await parts.recoveryAction.actionInfo(block) };
  } catch {
    return { answered: false };
  }
}

/** The action's `MANAGER()` at the block; a revert or undecodable answer reads as unanswered, a failed transport propagates. */
const managerRead = (parts: SetupClientParts, block: PinnedBlock): Promise<ReadResult<Address>> =>
  actionManagerAt(parts.provider, parts.action, block.number);

/** The action contract's reads at the block, beside the account's code read the caller made once. */
async function actionReads(parts: SetupClientParts, block: PinnedBlock, deployed: Promise<boolean>): Promise<ActionReads> {
  const [actionInfo, supportsAccount, accountHoldsCode, manager] = await Promise.all([
    actionInfoRead(parts, block),
    parts.recoveryAction.supportsAccount(block),
    deployed,
    managerRead(parts, block),
  ]);

  return { address: parts.action, actionInfo, supportsAccount, accountHoldsCode, manager };
}

/** Each distinct method's reads, once per method, and the action's reads, all at the block; `deployed` is the account's one code read. */
export async function judgmentReads(
  parts: SetupClientParts,
  methods: readonly Address[],
  block: PinnedBlock,
  deployed: Promise<boolean>,
): Promise<JudgmentReads> {
  const [methodEntries, action] = await Promise.all([
    Promise.all(methods.map((module) => methodReads(parts, module, block))),
    actionReads(parts, block, deployed),
  ]);

  return { methods: methodEntries, action: await withFallbackHandler(parts, block, action) };
}

/** The manager's setup notifications over the account with the action topic left open, from the deployment block to the pinned one. */
export async function accountWideEvents(parts: SetupClientParts, block: PinnedBlock): Promise<readonly KitNotification[]> {
  const from = parts.descriptor.deployedAt;

  if (from > block.number) return [];

  return await parts.events.fetch(parts.events.accountFilter({ allActions: true }), { from, to: block.number });
}

/** Whether the account holds code at the block; an account not yet deployed answers none of the action's authority reads. */
export async function holdsCode(parts: SetupClientParts, block: PinnedBlock): Promise<boolean> {
  const code: unknown = await parts.provider.code(parts.account, block.number);

  assertBytes(code, 'code');

  return code.toLowerCase() !== '0x';
}

/** Whether the action is authorized on the account at the block; false without asking where the account holds no code. */
export async function authorizedAt(parts: SetupClientParts, block: PinnedBlock): Promise<boolean> {
  if (!(await holdsCode(parts, block))) return false;

  return await parts.recoveryAction.isAuthorized(block);
}

/** The account's word under its fallback-handler slot at the block; any rejection, a revert, an undecodable answer or a failed transport, reads as unanswered. */
async function fallbackHandlerRead(parts: SetupClientParts, block: PinnedBlock): Promise<ReadResult<Hex>> {
  const data = encodeFunctionData({ abi: RECOVERY_ACTION_PRIVILEGES_ABI, functionName: 'privileges', args: [RECOVERY_ACTION_FALLBACK_HANDLER_SLOT] });

  try {
    const returned = await parts.provider.call(parts.account, data, RECOVERY_ACTION_READ_FROM, block.number);

    return { answered: true, value: lowerHex(wordReturn(returned, 'privileges')) };
  } catch {
    return { answered: false };
  }
}

/** The action's reads with the account's fallback-handler entry, read only where the account holds code the deployment's own action serves. */
async function withFallbackHandler(parts: SetupClientParts, block: PinnedBlock, action: ActionReads): Promise<ActionReads> {
  if (!(action.accountHoldsCode && action.supportsAccount && sameAddress(parts.action, parts.descriptor.action))) return action;

  return { ...action, fallbackHandlerEntry: await fallbackHandlerRead(parts, block) };
}
