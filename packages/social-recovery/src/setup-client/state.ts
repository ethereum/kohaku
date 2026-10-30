import { configurationBody, restoreConfiguration, setupStands } from '../client-core';
import { SETUP_CLIENT_LIVE_ATTEMPT_STATE } from '../constants';
import { assertPassword } from '../encryption/cipher';
import { assertObject, lowerHex } from '../formats/guards';
import type { Configuration, ConfigurationSource, SetupState } from '../interfaces';
import type { SetupClientParts } from '../types/setup-client';
import { authorizedAt, pinRead } from './reads';

/** The setup-side reading of the account at one pinned block. */
export async function stateAt(parts: SetupClientParts): Promise<SetupState> {
  const { header, block } = await pinRead(parts);
  const [state, isAuthorized] = await Promise.all([parts.policyManager.stateOf(block), authorizedAt(parts, block)]);
  const hasSetup = setupStands(state);

  assertObject(state.attempt, 'state.attempt');

  return {
    isAuthorized,
    hasSetup,
    setupCommitment: lowerHex(state.setupCommitment),
    setupNonce: state.setupNonce,
    setupCommittedAtBlock: state.setupCommittedAtBlock,
    attemptActive: state.attempt.state === SETUP_CLIENT_LIVE_ATTEMPT_STATE,
    block: header,
  };
}

/**
 * The setup standing at one pinned block, restored from the source given; refuses with the restore cause.
 * A malformed source throws a `TypeError` or `RangeError` before any read.
 */
export async function restoreAt(parts: SetupClientParts, source: ConfigurationSource): Promise<Configuration> {
  assertObject(source, 'source');

  if ('password' in source) assertPassword(source.password);
  else configurationBody(source, parts.account);

  const { block } = await pinRead(parts);
  const state = await parts.policyManager.stateOf(block);

  return await restoreConfiguration(parts.events, parts.account, parts.action, source, state, block);
}
