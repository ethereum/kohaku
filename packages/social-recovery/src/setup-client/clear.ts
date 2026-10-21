import { setupStands, simulatePrepared } from '../client-core';
import type { PreparedBatch, PreparedCall, PrepareOptions } from '../interfaces';
import type { SetupClientParts } from '../types/setup-client';
import { assertOptions } from './check';
import { authorizedAt, pinRead } from './reads';

/**
 * The clear at one pinned block, its shape set by whether a setup stands and the action is authorized: the clear and the
 * disarming write as one atomic batch, the clear alone, or the disarming write alone where no setup stands.
 */
export async function prepareClear(parts: SetupClientParts, options: PrepareOptions | undefined): Promise<PreparedCall | PreparedBatch> {
  assertOptions(options);

  const { block } = await pinRead(parts);
  const [state, authorized] = await Promise.all([parts.policyManager.stateOf(block), authorizedAt(parts, block)]);
  let prepared: PreparedCall | PreparedBatch;

  if (!setupStands(state)) {
    prepared = await parts.recoveryAction.disarmingCall(block);
  } else if (!authorized) {
    prepared = await parts.policyManager.prepareClearSetup(parts.action, state.setupNonce, block);
  } else {
    const clear = await parts.policyManager.prepareClearSetup(parts.action, state.setupNonce, block);
    const disarming = await parts.recoveryAction.disarmingCall(block);

    prepared = { kind: 'batch', calls: [clear, disarming], atomic: true, block };
  }

  return await simulatePrepared(parts.provider, prepared, parts.account, parts.configuration, options);
}
