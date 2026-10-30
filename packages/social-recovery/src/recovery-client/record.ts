import type { GatheredSetup, InitReading, RecoveryClientParts, SharedRequest } from '../types/recovery-client';

/** The request members both gatherings share, from the descriptor, the init's reading and the restored setup. */
export function sharedRequest(
  parts: RecoveryClientParts,
  { pinned }: InitReading,
  setup: GatheredSetup,
  attemptId: bigint,
  setupNonce: bigint,
  validUntil: number,
): SharedRequest {
  const { header } = pinned;

  return {
    chainId: String(parts.descriptor.chainId),
    manager: parts.descriptor.manager,
    digestVersion: parts.descriptor.digestVersion,
    account: parts.account,
    action: parts.action,
    attemptId: attemptId.toString(),
    setupNonce: setupNonce.toString(),
    setupBody: setup.setupBody,
    validUntil: String(validUntil),
    block: { number: header.number, timestamp: String(header.timestamp), hash: header.hash },
  };
}

