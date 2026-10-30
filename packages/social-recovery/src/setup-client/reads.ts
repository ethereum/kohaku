import { pinBlockHeader } from '../client-core';
import { assertBytes, sameAddress } from '../formats/guards';
import {
  METHOD_TIERS,
  type ActionInfo,
  type Address,
  type IRecoveryMethod,
  type KitNotification,
  type MethodTier,
  type PinnedBlock,
  type ReadResult,
} from '../interfaces';
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

/** One method module's reads at the block, beside whether this build serves it and the tier it states. */
async function methodReads(parts: SetupClientParts, module: Address, block: PinnedBlock): Promise<MethodReads> {
  const [moduleInfo, trustedParties, paused] = await Promise.all([
    parts.policyManager.moduleInfo(module, block),
    parts.policyManager.trustedParties(module, block),
    parts.policyManager.paused(module, block),
  ]);
  const implementation = implementationOf(parts, module);
  const tier = tierOf(implementation);

  return { module, moduleInfo, trustedParties, paused, implemented: implementation !== undefined, ...(tier === undefined ? {} : { tier }) };
}

/** The action's identity at the block; any rejection, a revert, an undecodable answer or a failed transport, reads as unanswered. */
async function actionInfoRead(parts: SetupClientParts, block: PinnedBlock): Promise<ReadResult<ActionInfo>> {
  try {
    return { answered: true, value: await parts.recoveryAction.actionInfo(block) };
  } catch {
    return { answered: false };
  }
}

/** The action contract's reads at the block. */
async function actionReads(parts: SetupClientParts, block: PinnedBlock): Promise<ActionReads> {
  const [actionInfo, supportsAccount] = await Promise.all([
    actionInfoRead(parts, block),
    parts.recoveryAction.supportsAccount(block),
  ]);

  return { address: parts.action, actionInfo, supportsAccount };
}

/** Each distinct method's reads, once per method, and the action's reads, all at the block. */
export async function judgmentReads(parts: SetupClientParts, methods: readonly Address[], block: PinnedBlock): Promise<JudgmentReads> {
  const [methodEntries, action] = await Promise.all([
    Promise.all(methods.map((module) => methodReads(parts, module, block))),
    actionReads(parts, block),
  ]);

  return { methods: methodEntries, action };
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
