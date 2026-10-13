import type { AbiFunctionItem, Hex } from '../interfaces/records';

/** The refusal message when an opening init finds an attempt already waiting. */
export const RECOVERY_CLIENT_ATTEMPT_WAITING_MESSAGE = 'an attempt is already waiting for this account and action';

/** The refusal message when a cancel init finds no attempt waiting. */
export const RECOVERY_CLIENT_NO_ATTEMPT_WAITING_MESSAGE = 'no attempt is waiting for this account and action';

/** The refusal message when the handover would not pass the action's own checks, or its removed key cannot be named. */
export const RECOVERY_CLIENT_HANDOVER_REFUSED_MESSAGE = 'the handover would not pass the action';

/** The rejection message when a rule method's stop or trusted-parties read went unanswered. */
export const RECOVERY_CLIENT_UNANSWERED_READ_MESSAGE = 'a rule method read went unanswered';

/** What `eth_getCode` answers for an address that holds no code. */
export const RECOVERY_CLIENT_NO_CODE: Hex = '0x';

/** The refusal message when a payload does not hold a handover the action would execute. */
export const RECOVERY_CLIENT_PAYLOAD_MALFORMED_MESSAGE = 'the payload does not hold a handover the action would execute';

/** The refusal message when the payload does not hash to the attempt's committed payload hash. */
export const RECOVERY_CLIENT_PAYLOAD_HASH_MESSAGE = "the payload does not hash to the attempt's payload hash";

/** The refusal message when the attempt passed is not the one the manager holds for the account and action. */
export const RECOVERY_CLIENT_ATTEMPT_DIFFERS_MESSAGE = 'the attempt passed is not the one the manager holds';

/** The refusal message when a method the attempt used is stopped, so the manager would veto the spend. */
export const RECOVERY_CLIENT_SPEND_VETOED_MESSAGE = 'a method the attempt used is stopped and vetoes the spend';

/** The argument error when an open payee would be paid and no `from` names who sends the call. */
export const RECOVERY_CLIENT_OPEN_PAYEE_MESSAGE = 'options.from is required: the order pays an open payee, which is the sender of the call';

/** The action's `executeHandover(address _account, bytes _payload)`. */
export const RECOVERY_CLIENT_EXECUTE_HANDOVER_ABI = [
  {
    type: 'function',
    name: 'executeHandover',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_account', type: 'address' },
      { name: '_payload', type: 'bytes' },
    ],
    outputs: [],
  },
] as const satisfies readonly AbiFunctionItem[];

/** The manager's `consume(address _action, uint64 _attemptId, bytes32 _payloadHash)`, the first call of the executed batch. */
export const RECOVERY_CLIENT_CONSUME_ABI = [
  {
    type: 'function',
    name: 'consume',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_action', type: 'address' },
      { name: '_attemptId', type: 'uint64' },
      { name: '_payloadHash', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const satisfies readonly AbiFunctionItem[];

/** The ERC-20 `transfer(address to, uint256 value)` the batch pays a token order with. */
export const RECOVERY_CLIENT_ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const satisfies readonly AbiFunctionItem[];
