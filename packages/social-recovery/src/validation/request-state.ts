import { CLIENT_CORE_NO_SETUP_COMMITMENT } from '../constants';
import { setupCommitment } from '../formats/commitments';
import type { ActionState } from '../interfaces';
import type { CheckedRequest, Findings } from '../types/validation';
import { addError } from './common';

/**
 * The findings the stored setup and attempt reach, in the manager's order: no setup standing (an opening only), a live or
 * missing attempt, a request under another setup nonce, the id, a moved attempt nonce, and the body's commitment, recomputed
 * under the stored nonce and left unjudged while no setup stands.
 */
export function stateFindings(request: CheckedRequest, state: ActionState, findings: Findings): void {
  const { attempt } = state;
  const waiting = attempt.state === 'Waiting';
  const noSetup = state.setupCommitment.toLowerCase() === CLIENT_CORE_NO_SETUP_COMMITMENT;
  const nonceMoved = request.setupNonce !== state.setupNonce;

  if (request.opening) {
    if (noSetup) addError(findings, 'request.no-setup', 'request', { account: request.account, action: request.action });

    if (waiting) {
      addError(findings, 'request.attempt-active', 'request', {
        attemptId: attempt.attemptId,
        consumableAfter: attempt.consumableAfter,
        ownRequest: attempt.attemptId === request.attemptId,
      });
    }

    if (nonceMoved) addError(findings, 'request.setup-nonce', 'request', { setupNonce: request.setupNonce, expected: state.setupNonce });

    if (request.attemptId !== state.nextAttemptId) {
      addError(findings, 'request.attempt-id', 'request', { attemptId: request.attemptId, expected: state.nextAttemptId });
    }
  } else {
    if (!waiting) addError(findings, 'request.no-active-attempt', 'request', { action: request.action, state: attempt.state });

    if (nonceMoved) addError(findings, 'request.setup-nonce', 'request', { setupNonce: request.setupNonce, expected: state.setupNonce });

    if (waiting && request.attemptId !== attempt.attemptId) {
      addError(findings, 'request.attempt-id', 'request', { attemptId: request.attemptId, expected: attempt.attemptId });
    }

    if (waiting && attempt.setupNonce !== state.setupNonce) {
      addError(findings, 'request.stale-attempt', 'request', { judgedUnder: attempt.setupNonce, currentNonce: state.setupNonce });
    }
  }

  if (noSetup) return;

  const recomputed = setupCommitment(request.account, request.action, state.setupNonce, request.setupBody);

  if (recomputed !== state.setupCommitment.toLowerCase()) {
    addError(findings, 'request.body-mismatch', 'request', { recomputed, committed: state.setupCommitment });
  }
}
