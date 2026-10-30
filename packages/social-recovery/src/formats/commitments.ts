import { encodeAbiParameters, keccak256 } from 'viem';
import { FORMATS_CREDENTIAL_HASH_ABI, FORMATS_SETUP_COMMITMENT_ABI, FORMATS_SETUP_NONCE_BITS } from '../constants';
import type { Address, Hex } from '../interfaces';
import { assertBytes, assertBytes32, assertUintBigint, normalizeAddress } from './guards';

/** The credential commitment the manager recomputes before it dispatches a proof; the salt is taken as given. */
export function credentialHash(method: Address, config: Hex, salt: Hex): Hex {
  const methodAddress = normalizeAddress(method, 'method');

  assertBytes(config, 'config');
  assertBytes32(salt, 'salt');

  return keccak256(encodeAbiParameters(FORMATS_CREDENTIAL_HASH_ABI, [methodAddress, config, salt]));
}

/** The `setupBodyHash` member both digests carry. */
export function setupBodyHash(setupBody: Hex): Hex {
  assertBytes(setupBody, 'setupBody');

  return keccak256(setupBody);
}

/** The setup commitment over the encoded body; zero-length body bytes are hashed, not refused. */
export function setupCommitment(account: Address, action: Address, nonce: bigint, setupBody: Hex): Hex {
  const accountAddress = normalizeAddress(account, 'account');
  const actionAddress = normalizeAddress(action, 'action');

  assertUintBigint(nonce, FORMATS_SETUP_NONCE_BITS, 'nonce');
  assertBytes(setupBody, 'setupBody');

  return keccak256(encodeAbiParameters(FORMATS_SETUP_COMMITMENT_ABI, [accountAddress, actionAddress, nonce, setupBody]));
}
