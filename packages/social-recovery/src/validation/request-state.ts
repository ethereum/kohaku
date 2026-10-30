import { setupCommitment } from '../formats/commitments';
import type { ActionState } from '../interfaces';
import type { CheckedRequest, Findings } from '../types/validation';
import { addError } from './common';

/** The findings the stored setup and attempt reach: the id, a live or missing attempt, a moved nonce, the body's commitment. */
export function stateFindings(request: CheckedRequest, state: ActionState, findings: Findings): void {
  const { attempt } = state;
  const waiting = attempt.state === 'Waiting';

  if (request.opening) {
    if (waiting) {
      addError(findings, 'request.attempt-active', 'request', {
        attemptId: attempt.attemptId,
        consumableAfter: attempt.consumableAfter,
        ownRequest: attempt.attemptId === request.attemptId,
      });
    }

    if (request.attemptId !== state.nextAttemptId) {
      addError(findings, 'request.attempt-id', 'request', { attemptId: request.attemptId, expected: state.nextAttemptId });
    }
  } else {
    if (!waiting) addError(findings, 'request.no-active-attempt', 'request', { action: request.action, state: attempt.state });

    if (waiting && request.attemptId !== attempt.attemptId) {
      addError(findings, 'request.attempt-id', 'request', { attemptId: request.attemptId, expected: attempt.attemptId });
    }

    if (waiting && attempt.setupNonce !== state.setupNonce) {
      addError(findings, 'request.stale-attempt', 'request', { judgedUnder: attempt.setupNonce, currentNonce: state.setupNonce });
    }
  }

  const recomputed = setupCommitment(request.account, request.action, request.setupNonce, request.setupBody);

  if (recomputed !== state.setupCommitment.toLowerCase()) {
    addError(findings, 'request.body-mismatch', 'request', { recomputed, committed: state.setupCommitment });
  }
}
