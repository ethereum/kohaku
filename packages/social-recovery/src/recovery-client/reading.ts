import {
  FORMATS_ATTEMPT_ID_BITS,
  FORMATS_VALID_UNTIL_BITS,
  RECOVERY_CLIENT_ATTEMPT_WAITING_MESSAGE,
  RECOVERY_CLIENT_NO_ATTEMPT_WAITING_MESSAGE,
} from '../constants';
import { configurationBody, KitRefusalError, pinBlockHeader, restoreConfiguration } from '../client-core';
import { encodeSetupBody } from '../formats';
import { assertBytes, assertObject, assertUintBigint, assertUintNumber, lowerHex } from '../formats/guards';
import { placeMap } from '../gathering';
import { ATTEMPT_STATES, type ActionState, type Configuration, type ConfigurationSource, type Credential } from '../interfaces';
import type { GatheredSetup, InitReading, RecoveryClientParts } from '../types/recovery-client';
import { placeStandings } from './standings';

/** Refuses a state whose attempt members or next attempt id an init reads are malformed. */
export function assertAttemptState(state: ActionState): void {
  assertObject(state, 'state');
  assertUintBigint(state.nextAttemptId, FORMATS_ATTEMPT_ID_BITS, 'state.nextAttemptId');
  assertObject(state.attempt, 'state.attempt');

  if (!ATTEMPT_STATES.includes(state.attempt.state)) throw new TypeError(`state.attempt.state must be one of ${ATTEMPT_STATES.join(', ')}`);

  assertUintBigint(state.attempt.attemptId, FORMATS_ATTEMPT_ID_BITS, 'state.attempt.attemptId');
  assertUintNumber(state.attempt.consumableAfter, FORMATS_VALID_UNTIL_BITS, 'state.attempt.consumableAfter');
}

/** Pins one block at the read tag and reads the manager's state for the account and action at it. */
export async function readState(parts: RecoveryClientParts): Promise<InitReading> {
  const pinned = await pinBlockHeader(parts.provider, parts.configuration.blockTags.read);
  const state = await parts.policyManager.stateOf(pinned.block);

  assertAttemptState(state);

  return { pinned, state };
}

/** Refuses an opening while an attempt is waiting. */
export function assertNoAttemptWaiting({ attempt }: ActionState): void {
  if (attempt.state !== 'Waiting') return;

  throw new KitRefusalError(RECOVERY_CLIENT_ATTEMPT_WAITING_MESSAGE, {
    findings: {
      errors: [
        {
          code: 'request.attempt-active',
          subject: 'request',
          values: { attemptId: attempt.attemptId, consumableAfter: attempt.consumableAfter, ownRequest: false },
        },
      ],
      warnings: [],
    },
  });
}

/** Refuses a cancellation while no attempt is waiting. */
export function assertAttemptWaiting({ attempt }: ActionState, parts: RecoveryClientParts): void {
  if (attempt.state === 'Waiting') return;

  throw new KitRefusalError(RECOVERY_CLIENT_NO_ATTEMPT_WAITING_MESSAGE, {
    findings: {
      errors: [{ code: 'request.no-active-attempt', subject: 'request', values: { action: parts.action, state: attempt.state } }],
      warnings: [],
    },
  });
}

/** A copy of the credential with its config and any salt lower-cased, refusing one that is not whole bytes of hex. */
function lowerCredential(credential: Credential, name: string): Credential {
  assertBytes(credential.config, `${name}.config`);

  const copy: Credential = { ...credential, config: lowerHex(credential.config) };

  return credential.salt === undefined ? copy : { ...copy, salt: lowerHex(credential.salt) };
}

/** A copy of a restored configuration with every config and salt lower-cased; the caller's source is left as given. */
function lowerConfiguration(configuration: Configuration): Configuration {
  return {
    ...configuration,
    clauses: configuration.clauses.map((clause, index) => ({
      ...clause,
      credentials: clause.credentials.map((credential, position) =>
        lowerCredential(credential, `configuration.clauses[${index}].credentials[${position}]`),
      ),
    })),
  };
}

/**
 * The setup restored behind the init's own block and state reading, with each place's standing read at that block.
 * A restore refusal carries its restore cause; a failed read rejects as itself.
 */
export async function gatheredSetup(parts: RecoveryClientParts, source: ConfigurationSource, reading: InitReading): Promise<GatheredSetup> {
  const { block } = reading.pinned;
  const restored = await restoreConfiguration(parts.events, parts.account, parts.action, source, reading.state, block);
  const configuration = lowerConfiguration(restored);
  const body = configurationBody(configuration, parts.account);
  const standings = await placeStandings(parts, configuration, block);

  return { setupBody: encodeSetupBody(body), places: placeMap(body, configuration, standings, parts.account) };
}
