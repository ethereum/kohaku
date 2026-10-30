import { encodeFunctionData } from 'viem';
import {
  FORMATS_ZERO_ADDRESS,
  POLICY_MANAGER_TRUE_WORD,
  RECOVERY_ACTION_DISARMED_VALUE,
  RECOVERY_ACTION_SET_ADDR_PRIVILEGE_ABI,
  RECOVERY_CLIENT_CONSUME_ABI,
  RECOVERY_CLIENT_ERC20_TRANSFER_ABI,
  RECOVERY_CLIENT_EXECUTE_HANDOVER_ABI,
} from '../constants';
import { lowerHex, sameAddress } from '../formats/guards';
import type { Address, Attempt, DescribedCall, Handover, Hex, PinnedBlock, PreparedCall } from '../interfaces';
import type { RecoveryClientParts } from '../types/recovery-client';

/** The account's own `setAddrPrivilege(key, word)` call. */
function privilegeCall(account: Address, key: Address, word: Hex): DescribedCall {
  const data = encodeFunctionData({ abi: RECOVERY_ACTION_SET_ADDR_PRIVILEGE_ABI, args: [key, word] });

  return { target: account, value: 0n, data };
}

/** The payment of the order to the payee: a value call for the native asset, a token `transfer` otherwise. */
function paymentCall({ token, amount }: Attempt['order'], payee: Address): DescribedCall {
  if (sameAddress(token, FORMATS_ZERO_ADDRESS)) return { target: payee, value: amount, data: '0x' };

  const data = encodeFunctionData({ abi: RECOVERY_CLIENT_ERC20_TRANSFER_ABI, args: [payee, amount] });

  return { target: token, value: 0n, data };
}

/**
 * The batch the Ambire action runs on the account, in its order: the manager's consume, the grant of the new key, the revoke
 * of the removed one, and the payment only where the order's amount is nonzero.
 */
export function describedBatch(
  parts: RecoveryClientParts,
  attempt: Attempt,
  handover: Required<Handover>,
  payloadHash: Hex,
  payee: Address | undefined,
): DescribedCall[] {
  const consumeData = encodeFunctionData({ abi: RECOVERY_CLIENT_CONSUME_ABI, args: [parts.action, attempt.attemptId, payloadHash] });
  const calls: DescribedCall[] = [
    { target: parts.descriptor.manager, value: 0n, data: consumeData },
    privilegeCall(parts.account, handover.newAuthority, POLICY_MANAGER_TRUE_WORD),
    privilegeCall(parts.account, handover.removedAuthority, RECOVERY_ACTION_DISARMED_VALUE),
  ];

  if (attempt.order.amount === 0n || payee === undefined) return calls;

  return [...calls, paymentCall(attempt.order, payee)];
}

/** The action's `executeHandover(account, payload)` call, sent by anyone with no value, describing the batch it runs. */
export function executeCall(parts: RecoveryClientParts, payload: Hex, block: PinnedBlock, describes: readonly DescribedCall[]): PreparedCall {
  const data = encodeFunctionData({ abi: RECOVERY_CLIENT_EXECUTE_HANDOVER_ABI, args: [parts.account, lowerHex(payload)] });

  return { kind: 'call', target: parts.action, value: 0n, data, sender: 'anyone', block, describes };
}
