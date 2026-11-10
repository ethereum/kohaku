import { hexToBigInt } from 'viem';
import { RECOVERY_ACTION_FALLBACK_HANDLER_SLOT } from '../constants';
import { assertArray, normalizeAddress } from '../formats/guards';
import type { Address, FindingValues, KitNotification } from '../interfaces';
import type { Findings, SetupEvent, SetupValidationContext } from '../types/validation';
import { addError, addWarning, assertActionReads, fallbackHandlerOf, normalizeAddresses } from './common';

/**
 * The account's deployment, the action's fit and audit findings: `account.not-deployed` in place of `action.unsupported`
 * where the account holds no code, since the fit is then unjudgeable, and `action.unaudited`.
 */
export function actionFindings(context: SetupValidationContext, findings: Findings): void {
  assertActionReads(context.action, 'context.action');

  const action = normalizeAddress(context.action.address, 'context.action.address');
  const account = normalizeAddress(context.account, 'context.account');
  const { actionInfo, supportsAccount, accountHoldsCode } = context.action;
  const { accountImplementation } = context.configuration;

  if (!accountHoldsCode || !supportsAccount) {
    const named: FindingValues =
      accountImplementation === undefined
        ? {}
        : { accountImplementation: normalizeAddress(accountImplementation, 'context.configuration.accountImplementation') };
    const served = normalizeAddress(context.descriptor.servedImplementation, 'context.descriptor.servedImplementation');

    if (accountHoldsCode) {
      addError(findings, 'action.unsupported', 'action', { action, account, supportsAccount, ...named, servedImplementation: served });
    } else {
      addError(findings, 'account.not-deployed', 'account', { account, servedImplementation: served, ...named });
    }
  }

  const auditedActions = normalizeAddresses(context.descriptor.auditedActions, 'context.descriptor.auditedActions');

  if (!auditedActions.includes(action)) {
    addWarning(findings, 'action.unaudited', 'action', {
      action,
      probeAnswered: actionInfo.answered,
      probePassed: actionInfo.answered && actionInfo.value.supportsInterface,
      auditedActions,
      descriptorOrigin: context.descriptorOrigin,
    });
  }
}

/** `action.manager-mismatch` where the action's `MANAGER()` answers another manager than the descriptor's, the only one whose attempts it spends. */
export function actionManagerFindings(context: SetupValidationContext, findings: Findings): void {
  const answer = context.action.manager;

  if (!answer.answered) return;

  const action = normalizeAddress(context.action.address, 'context.action.address');
  const manager = normalizeAddress(context.descriptor.manager, 'context.descriptor.manager');
  const actionManager = normalizeAddress(answer.value, 'context.action.manager.value');

  if (actionManager !== manager) addError(findings, 'action.manager-mismatch', 'action', { action, manager, actionManager });
}

const isSetupEvent = (event: KitNotification): event is SetupEvent =>
  event.kind === 'setup-committed' || event.kind === 'setup-cleared';

const byPosition = (left: SetupEvent, right: SetupEvent): number =>
  left.at.blockNumber - right.at.blockNumber || left.at.logIndex - right.at.logIndex;

/** `manager.already-armed` per other action whose last setup event over this account is a commit rather than a clear. */
export function alreadyArmedFindings(context: SetupValidationContext, findings: Findings): void {
  assertArray(context.managerEvents, 'context.managerEvents');

  const account = normalizeAddress(context.account, 'context.account');
  const ownAction = normalizeAddress(context.action.address, 'context.action.address');
  const last = new Map<Address, SetupEvent>();
  const events = context.managerEvents
    .filter(isSetupEvent)
    .filter((event) => !event.at.removed && normalizeAddress(event.account, 'event.account') === account)
    .sort(byPosition);

  for (const event of events) {
    const action = normalizeAddress(event.action, 'event.action');

    if (action !== ownAction) last.set(action, event);
  }

  for (const [action, event] of last) {
    if (event.kind === 'setup-committed') {
      addWarning(findings, 'manager.already-armed', 'account', { account, action, nonce: event.nonce });
    }
  }
}

/** `account.fallback-handler` where the account keeps a nonzero word under its fallback-handler slot, code a recovery leaves in place. */
export function fallbackHandlerFindings(context: SetupValidationContext, findings: Findings): void {
  const read = context.action.fallbackHandlerEntry;

  if (read === undefined || !read.answered) return;

  const { entry, handler } = fallbackHandlerOf(read.value);

  if (hexToBigInt(entry) === 0n) return;

  const account = normalizeAddress(context.account, 'context.account');

  addWarning(findings, 'account.fallback-handler', 'account', {
    account,
    slot: RECOVERY_ACTION_FALLBACK_HANDLER_SLOT,
    entry,
    ...(handler === undefined ? {} : { handler }),
  });
}
