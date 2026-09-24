import {
  BACKUP_ADDRESS_SIZE,
  BACKUP_ASSOCIATED_DATA_SIZE,
  BACKUP_MAX_SETUP_NONCE,
  BACKUP_WORD_SIZE as WORD,
} from '../constants';
import type { BackupAuthenticated } from '../interfaces';
import { fixedHexToBytes, writeUint } from './hex';

/**
 * Encodes the values as `abi.encode(address account, address action, bytes32 setupCommitment, uint64 nonce,
 * uint256 payloadVersion)`; throws a TypeError or RangeError on a value outside its width.
 */
export function encodeAssociatedData(authenticated: BackupAuthenticated): Uint8Array<ArrayBuffer> {
  const account = fixedHexToBytes(authenticated.account, BACKUP_ADDRESS_SIZE, 'authenticated.account');
  const action = fixedHexToBytes(authenticated.action, BACKUP_ADDRESS_SIZE, 'authenticated.action');
  const commitment = fixedHexToBytes(authenticated.setupCommitment, WORD, 'authenticated.setupCommitment');
  const { nonce, payloadVersion } = authenticated;

  if (typeof nonce !== 'bigint' || nonce < 0n || nonce > BACKUP_MAX_SETUP_NONCE) {
    throw new RangeError('authenticated.nonce must be a bigint from 0 to 2^64 - 1');
  }

  if (typeof payloadVersion !== 'number' || !Number.isSafeInteger(payloadVersion) || payloadVersion < 0) {
    throw new RangeError('authenticated.payloadVersion must be a non-negative safe integer');
  }

  const out = new Uint8Array(BACKUP_ASSOCIATED_DATA_SIZE);

  out.set(account, WORD - account.length);
  out.set(action, 2 * WORD - action.length);
  out.set(commitment, 2 * WORD);
  writeUint(out, 3 * WORD, WORD, nonce);
  writeUint(out, 4 * WORD, WORD, BigInt(payloadVersion));

  return out;
}
