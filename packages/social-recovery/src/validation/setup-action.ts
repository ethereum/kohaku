import { assertArray, normalizeAddress } from '../formats/guards';
import type { Address, FindingValues, KitNotification } from '../interfaces';
import type { Findings, SetupEvent, SetupValidationContext } from '../types/validation';
import { addError, addWarning, assertActionReads, normalizeAddresses } from './common';

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
