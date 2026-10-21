import { encodeAbiParameters } from 'viem';
import type { AttemptRequest, CancelRequest, PinnedBlock, PolicyManager } from '../../src/index';
import { bySelector, type Answer, type ProviderDouble } from './double';
import {
  ACCOUNT,
  ACTION,
  ACTION_STATE_PARAMS,
  DOMAIN_PARAMS,
  METHOD,
  PARTIES_PARAMS,
  STRING_PARAMS,
  TRUE_WORD,
  attemptRequestOf,
  cancelRequestOf,
  sel,
  vectorRow,
} from './fixtures';

const stateReturn = encodeAbiParameters(ACTION_STATE_PARAMS, [
  {
    setupCommitment: `0x${'11'.repeat(32)}`,
    setupNonce: 1n,
    nextAttemptId: 1n,
    setupCommittedAtBlock: 1,
    attempt: {
      attemptId: 0n,
      setupNonce: 0n,
      consumableAfter: 0,
      state: 0,
      ignoresPause: false,
      payloadHash: `0x${'00'.repeat(32)}`,
      order: { token: ACCOUNT, amount: 0n, payee: ACCOUNT },
      usedMethods: [],
    },
  },
]);

/** A double that answers every view of the manager and of a module well. */
export const answeringAll = (): ProviderDouble =>
  bySelector({
    [sel('stateOf')]: { returns: stateReturn },
    [sel('eip712Domain')]: {
      returns: encodeAbiParameters(DOMAIN_PARAMS, ['0x0f', 'n', 'v', 1n, ACCOUNT, `0x${'00'.repeat(32)}`, []]),
    },
    [sel('name')]: { returns: encodeAbiParameters(STRING_PARAMS, ['n']) },
    [sel('version')]: { returns: encodeAbiParameters(STRING_PARAMS, ['v']) },
    [sel('supportsInterface')]: { returns: TRUE_WORD },
    [sel('paused')]: { returns: TRUE_WORD },
    [sel('trustedParties')]: { returns: encodeAbiParameters(PARTIES_PARAMS, [ACCOUNT, ACCOUNT, [], ACCOUNT, ACCOUNT]) },
    [sel('hashApproval')]: { returns: TRUE_WORD },
    [sel('hashCancel')]: { returns: TRUE_WORD },
  } as Record<string, Answer>);

/** The blessed requests moved onto the tests' bound pair. */
const attempt = (): AttemptRequest => ({ ...attemptRequestOf(vectorRow('attempt-request.json', 'sorted-proofs')), account: ACCOUNT, action: ACTION });
const cancel = (): CancelRequest => ({ ...cancelRequestOf(vectorRow('cancel-request.json', 'one-proof')), account: ACCOUNT, action: ACTION });

/** The trailing arguments a member is called with: none, or one block argument of any shape. */
export type Trailing = readonly [] | readonly [unknown];

/** One member of the part, called with its ordinary arguments and the given trailing ones. */
export type Member = {
  readonly name: string;
  readonly calls: number;
  readonly prepare: boolean;
  readonly invoke: (part: PolicyManager, trailing: Trailing) => Promise<unknown>;
};

/** Spreads the trailing arguments as the optional block argument. */
const rest = (trailing: Trailing): [PinnedBlock?] => [...trailing] as [PinnedBlock?];

const member = (name: string, calls: number, invoke: Member['invoke']): Member => ({ name, calls, prepare: calls === 0, invoke });

/** Every read and every prepare of the part, with how many `call`s each makes. */
export const MEMBERS: readonly Member[] = [
  member('stateOf', 1, (part, t) => part.stateOf(...rest(t))),
  member('hashApproval', 1, (part, t) => part.hashApproval(attempt(), 0, ...rest(t))),
  member('hashCancel', 1, (part, t) => part.hashCancel(cancel(), 0, ...rest(t))),
  member('eip712Domain', 1, (part, t) => part.eip712Domain(...rest(t))),
  member('name', 1, (part, t) => part.name(...rest(t))),
  member('version', 1, (part, t) => part.version(...rest(t))),
  member('supportsInterface', 1, (part, t) => part.supportsInterface('0x01ffc9a7', ...rest(t))),
  member('moduleInfo', 3, (part, t) => part.moduleInfo(METHOD, ...rest(t))),
  member('paused', 1, (part, t) => part.paused(METHOD, ...rest(t))),
  member('trustedParties', 1, (part, t) => part.trustedParties(METHOD, ...rest(t))),
  member('prepareCommitSetup', 0, (part, t) => part.prepareCommitSetup(ACTION, `0x${'11'.repeat(32)}`, 1n, '0x', '0x', ...rest(t))),
  member('prepareClearSetup', 0, (part, t) => part.prepareClearSetup(ACTION, 1n, ...rest(t))),
  member('prepareCancelByOwner', 0, (part, t) => part.prepareCancelByOwner(ACTION, 1n, ...rest(t))),
  member('prepareStartAttempt', 0, (part, t) => part.prepareStartAttempt(attempt(), ...rest(t))),
  member('prepareCancelByProofs', 0, (part, t) => part.prepareCancelByProofs(cancel(), ...rest(t))),
  member('prepareCancelByVeto', 0, (part, t) => part.prepareCancelByVeto(ACCOUNT, ACTION, 1n, METHOD, ...rest(t))),
];
