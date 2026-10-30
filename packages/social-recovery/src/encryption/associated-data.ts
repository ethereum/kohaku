import { encodeAbiParameters } from 'viem';
import { BACKUP_ASSOCIATED_DATA_ABI, BACKUP_PAYLOAD_VERSION_BITS, FORMATS_SETUP_NONCE_BITS } from '../constants';
import { assertBytes32, assertObject, assertUintBigint, assertUintNumber, normalizeAddress } from '../formats/guards';
import type { BackupAuthenticated } from '../interfaces';
import { hexToBytes } from './hex';

/**
 * Encodes the values as `abi.encode(address account, address action, bytes32 setupCommitment, uint64 nonce,
 * uint256 payloadVersion)`; throws a TypeError on a malformed value and a RangeError on a number outside its width.
 */
export function encodeAssociatedData(authenticated: BackupAuthenticated): Uint8Array<ArrayBuffer> {
  assertObject(authenticated, 'authenticated');

  const account = normalizeAddress(authenticated.account, 'authenticated.account');
  const action = normalizeAddress(authenticated.action, 'authenticated.action');
  const { setupCommitment, nonce, payloadVersion } = authenticated;

  assertBytes32(setupCommitment, 'authenticated.setupCommitment');
  assertUintBigint(nonce, FORMATS_SETUP_NONCE_BITS, 'authenticated.nonce');
  assertUintNumber(payloadVersion, BACKUP_PAYLOAD_VERSION_BITS, 'authenticated.payloadVersion');

  const encoded = encodeAbiParameters(BACKUP_ASSOCIATED_DATA_ABI, [
    account,
    action,
    setupCommitment,
    nonce,
    BigInt(payloadVersion),
  ]);

  return hexToBytes(encoded, 'associated data');
}
