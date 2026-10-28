import { encodeErrorResult, parseAbi } from 'viem';
import type { Hex, PinnedBlock, PreparedBatch, PreparedCall } from '../../src/index';
import { ACCOUNT, ACTION, BLOCK, MANAGER } from './support';

/** A manager revert encoded independently: `PolicyManager_NoSetup(address,address)`. */
export const NO_SETUP_REVERT: Hex = encodeErrorResult({
  abi: parseAbi(['error PolicyManager_NoSetup(address _account, address _action)']),
  errorName: 'PolicyManager_NoSetup',
  args: [ACCOUNT, ACTION],
});

/** Revert data under a selector no kit ABI declares. */
export const UNKNOWN_REVERT: Hex = '0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001';

/** A prepared call to the manager with the given sender, pinned to `BLOCK` unless told otherwise. */
export const preparedCall = (sender: PreparedCall['sender'], data: Hex = '0x12345678', block: PinnedBlock = BLOCK): PreparedCall => ({
  kind: 'call',
  target: MANAGER,
  value: 0n,
  data,
  sender,
  block,
});

/** An atomic batch of an account-sent privilege write and an account-sent setup write. */
export const preparedBatch = (calls: readonly PreparedCall[] = [preparedCall('account', '0xaaaaaaaa'), preparedCall('account', '0xbbbbbbbb')]): PreparedBatch => ({
  kind: 'batch',
  calls,
  atomic: true,
  block: BLOCK,
});

/** Freezes a record and everything inside it, so a mutation throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const member of Object.values(value)) deepFreeze(member);
    Object.freeze(value);
  }

  return value;
}
