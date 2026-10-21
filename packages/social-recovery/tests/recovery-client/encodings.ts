import { encodeAbiParameters, encodeFunctionData, keccak256 } from 'viem';
import type { Address, AttemptRequest, CancelRequest, DescribedCall, Hex, PaymentOrder } from '../../src/index';

const PROOF_PLACE = {
  type: 'tuple[]',
  name: 'proofs',
  components: [
    { name: 'place', type: 'uint256' },
    { name: 'method', type: 'address' },
    { name: 'config', type: 'bytes' },
    { name: 'salt', type: 'bytes32' },
    { name: 'proof', type: 'bytes' },
  ],
} as const;

const ORDER = {
  type: 'tuple',
  name: 'order',
  components: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'payee', type: 'address' },
  ],
} as const;

/** The manager's and the action's writes, the account's `setAddrPrivilege` and ERC-20 `transfer`, written from the pinned contracts. */
export const PIN_WRITES_ABI = [
  {
    type: 'function',
    name: 'startAttempt',
    stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple',
        name: '_request',
        components: [
          { name: 'account', type: 'address' },
          { name: 'action', type: 'address' },
          { name: 'attemptId', type: 'uint64' },
          { name: 'setupNonce', type: 'uint64' },
          { name: 'setupBody', type: 'bytes' },
          { name: 'payload', type: 'bytes' },
          ORDER,
          { name: 'validUntil', type: 'uint48' },
          PROOF_PLACE,
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelByProofs',
    stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple',
        name: '_request',
        components: [
          { name: 'account', type: 'address' },
          { name: 'action', type: 'address' },
          { name: 'attemptId', type: 'uint64' },
          { name: 'setupNonce', type: 'uint64' },
          { name: 'setupBody', type: 'bytes' },
          { name: 'validUntil', type: 'uint48' },
          PROOF_PLACE,
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelByOwner',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_action', type: 'address' },
      { name: '_attemptId', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelByVeto',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_account', type: 'address' },
      { name: '_action', type: 'address' },
      { name: '_attemptId', type: 'uint64' },
      { name: '_method', type: 'address' },
    ],
    outputs: [],
  },
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
  {
    type: 'function',
    name: 'setAddrPrivilege',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'addr', type: 'address' },
      { name: 'priv', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const placesOf = (proofs: AttemptRequest['proofs']) => proofs.map((proof) => ({ ...proof, place: BigInt(proof.place) }));

/** `startAttempt(request)` calldata. */
export const startAttemptData = (request: AttemptRequest): Hex =>
  encodeFunctionData({ abi: PIN_WRITES_ABI, functionName: 'startAttempt', args: [{ ...request, proofs: placesOf(request.proofs) }] });

/** `cancelByProofs(request)` calldata. */
export const cancelByProofsData = (request: CancelRequest): Hex =>
  encodeFunctionData({ abi: PIN_WRITES_ABI, functionName: 'cancelByProofs', args: [{ ...request, proofs: placesOf(request.proofs) }] });

/** `cancelByOwner(action, attemptId)` calldata. */
export const cancelByOwnerData = (action: Address, attemptId: bigint): Hex =>
  encodeFunctionData({ abi: PIN_WRITES_ABI, functionName: 'cancelByOwner', args: [action, attemptId] });

/** `cancelByVeto(account, action, attemptId, method)` calldata. */
export const cancelByVetoData = (account: Address, action: Address, attemptId: bigint, method: Address): Hex =>
  encodeFunctionData({ abi: PIN_WRITES_ABI, functionName: 'cancelByVeto', args: [account, action, attemptId, method] });

/** `executeHandover(account, payload)` calldata. */
export const executeHandoverData = (account: Address, payload: Hex): Hex =>
  encodeFunctionData({ abi: PIN_WRITES_ABI, functionName: 'executeHandover', args: [account, payload] });

/** The account's privilege word for a key: one grants, zero revokes. */
export const word = (value: bigint): Hex => encodeAbiParameters([{ type: 'uint256' }], [value]);

/** `abi.encode(address, address)`, the handover payload layout. */
export const payloadOf = (newAuthority: Address, removedAuthority: Address): Hex =>
  encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [newAuthority, removedAuthority]);

/** The batch the action runs, built the way the pinned action builds it. */
export function describedBatch(
  manager: Address,
  account: Address,
  action: Address,
  attemptId: bigint,
  payload: Hex,
  handover: { readonly newAuthority: Address; readonly removedAuthority: Address },
  order: PaymentOrder,
  caller: Address | undefined,
): DescribedCall[] {
  const calls: DescribedCall[] = [
    { target: manager, value: 0n, data: encodeFunctionData({ abi: PIN_WRITES_ABI, functionName: 'consume', args: [action, attemptId, keccak256(payload)] }) },
    { target: account, value: 0n, data: encodeFunctionData({ abi: PIN_WRITES_ABI, functionName: 'setAddrPrivilege', args: [handover.newAuthority, word(1n)] }) },
    { target: account, value: 0n, data: encodeFunctionData({ abi: PIN_WRITES_ABI, functionName: 'setAddrPrivilege', args: [handover.removedAuthority, word(0n)] }) },
  ];

  if (order.amount === 0n) return calls;

  const payee = BigInt(order.payee) === 0n ? caller : order.payee;

  if (payee === undefined) throw new Error('an open payee needs a caller');

  calls.push(
    BigInt(order.token) === 0n
      ? { target: payee, value: order.amount, data: '0x' }
      : { target: order.token, value: 0n, data: encodeFunctionData({ abi: PIN_WRITES_ABI, functionName: 'transfer', args: [payee, order.amount] }) },
  );

  return calls;
}

/** A call compared case-insensitively on its addresses and bytes. */
export const loweredCall = (call: DescribedCall): DescribedCall => ({
  target: call.target.toLowerCase() as Address,
  value: call.value,
  data: call.data.toLowerCase() as Hex,
});
