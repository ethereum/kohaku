import {
  POLICY_MANAGER_EIP712_DOMAIN_ABI,
  POLICY_MANAGER_STATE_OF_ABI,
  POLICY_MANAGER_TRUSTED_PARTIES_ABI,
} from '../constants';
import { ATTEMPT_STATES, type ActionState, type AttemptState, type Domain, type Parties } from '../interfaces';
import { lowerHex } from '../formats/guards';
import { decodeReturn } from './chain';

/** The enum index as its state name; an index the enum does not declare throws a `TypeError`. */
function attemptState(index: number): AttemptState {
  const state = ATTEMPT_STATES[index];

  if (state === undefined) throw new TypeError(`stateOf returned the attempt state ${index}, which the enum does not declare`);

  return state;
}

/** The `stateOf` return as an `ActionState`; a return that does not decode throws a `TypeError`. */
export function actionStateFrom(returned: unknown): ActionState {
  const [state] = decodeReturn(POLICY_MANAGER_STATE_OF_ABI[0].outputs, returned, 'stateOf');
  const { attempt } = state;

  return {
    setupCommitment: lowerHex(state.setupCommitment),
    setupNonce: state.setupNonce,
    nextAttemptId: state.nextAttemptId,
    setupCommittedAtBlock: state.setupCommittedAtBlock,
    attempt: {
      attemptId: attempt.attemptId,
      setupNonce: attempt.setupNonce,
      consumableAfter: attempt.consumableAfter,
      state: attemptState(attempt.state),
      payloadHash: lowerHex(attempt.payloadHash),
      order: { ...attempt.order },
      usedMethods: [...attempt.usedMethods],
      ignoresPause: attempt.ignoresPause,
    },
  };
}

/** The `eip712Domain` return as a `Domain`; a return that does not decode, or a chain id beyond a safe integer, throws a `TypeError`. */
export function domainFrom(returned: unknown): Domain {
  const [fields, name, version, chainId, verifyingContract, salt, extensions] = decodeReturn(
    POLICY_MANAGER_EIP712_DOMAIN_ABI[0].outputs,
    returned,
    'eip712Domain',
  );

  if (chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`eip712Domain returned the chain id ${chainId}, which does not fit a safe integer`);
  }

  return {
    fields: lowerHex(fields),
    name,
    version,
    chainId: Number(chainId),
    verifyingContract,
    salt: lowerHex(salt),
    extensions: [...extensions],
  };
}

/** The `trustedParties` return as `Parties`; a return that does not decode throws a `TypeError`. */
export function partiesFrom(returned: unknown): Parties {
  const [admin, pendingAdmin, trustedKeys, pauseHolder, pendingPauseHolder] = decodeReturn(
    POLICY_MANAGER_TRUSTED_PARTIES_ABI[0].outputs,
    returned,
    'trustedParties',
  );

  return { admin, pendingAdmin, trustedKeys: trustedKeys.map(lowerHex), pauseHolder, pendingPauseHolder };
}
