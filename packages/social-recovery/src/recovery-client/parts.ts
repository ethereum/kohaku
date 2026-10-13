import { assertArray, assertDependency, normalizeAddress, sameAddress } from '../formats/guards';
import { checkedConfiguration, checkedDescriptor } from '../formats/records';
import type { RecoveryClientParts } from '../types/recovery-client';

/**
 * The parts with every address checksummed and the descriptor and configuration as checked copies, refusing a malformed
 * part, address or record member with a `TypeError` or `RangeError`, and an action the codec does not serve with a `RangeError`, before anything is read.
 */
export function checkedParts(given: Omit<RecoveryClientParts, 'walletMethod'>): RecoveryClientParts {
  assertDependency(given.provider, ['block', 'call', 'code', 'transaction'], 'provider');

  const descriptor = checkedDescriptor(given.descriptor, 'descriptor');
  const configuration = checkedConfiguration(given.configuration, 'configuration');

  assertDependency(
    given.policyManager,
    ['stateOf', 'paused', 'trustedParties', 'prepareStartAttempt', 'prepareCancelByProofs', 'prepareCancelByOwner', 'prepareCancelByVeto'],
    'policyManager',
  );
  assertDependency(given.recoveryAction, ['isAuthority', 'holdsAnyPrivilege'], 'recoveryAction');
  assertDependency(given.events, ['accountFilter', 'fetch'], 'events');
  assertDependency(given.methods, ['get', 'has'], 'methods');
  assertDependency(given.codec, ['encode', 'decode'], 'codec');
  assertArray(given.codec.actions, 'codec.actions');

  if (given.signerRecovery !== undefined) assertDependency(given.signerRecovery, ['recoverSigner'], 'signerRecovery');

  const account = normalizeAddress(given.account, 'account');
  const action = normalizeAddress(given.action, 'action');
  const served = given.codec.actions.map((entry, index) => normalizeAddress(entry, `codec.actions[${index}]`));

  if (!served.some((entry) => sameAddress(entry, action))) throw new RangeError(`action ${action} is not one the codec serves`);

  return { ...given, descriptor, configuration, account, action, walletMethod: descriptor.methodEcdsa };
}
