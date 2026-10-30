import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AmbireActionCodec, inferRemovedKey, type Address, type KitNotification, type RemovedKey } from '../../src/index';
import { runAsync } from '../policy-manager/runs';
import {
  ACCOUNT,
  ACTION,
  BLOCK,
  committed,
  consumed,
  DESCRIPTOR,
  FOREIGN_PAYLOAD,
  handoverPayload,
  INJECTED,
  key,
  KEYS,
  keySet,
  nodeFor,
  OTHER_ACCOUNT,
  rig,
  started,
  ZERO,
  type Read,
  type Rig,
  type World,
} from './doubles';

const codec = new AmbireActionCodec([ACTION]);

/** A payload: a key index installed, the zero key, or bytes no codec of this action decodes. */
type Payload = number | 'zero' | 'foreign' | 'trailing';

type AttemptPlan = {
  readonly attemptId: number;
  readonly payload: Payload;
  readonly removedIndex: number;
  readonly started: 'none' | 'live' | 'removed';
  readonly consumed: 'none' | 'live' | 'removed';
  readonly foreign: boolean;
};

type CommitPlan = { readonly removed: boolean; readonly foreign: boolean; readonly slot: number };

type Plan = {
  readonly attempts: readonly AttemptPlan[];
  readonly commits: readonly CommitPlan[];
  readonly authorities: readonly number[];
  readonly supplied: number | undefined;
  readonly signer: { readonly answer: number | undefined } | undefined;
  readonly deployedAbove: boolean;
};

const keyIndex = fc.integer({ min: 0, max: KEYS.length - 1 });

const attemptPlan: fc.Arbitrary<AttemptPlan> = fc.record({
  attemptId: fc.integer({ min: 1, max: 12 }),
  payload: fc.oneof(keyIndex, fc.constantFrom<Payload>('zero', 'foreign', 'trailing')),
  removedIndex: keyIndex,
  started: fc.constantFrom('none', 'live', 'live', 'removed'),
  consumed: fc.constantFrom('none', 'live', 'live', 'removed'),
  foreign: fc.integer({ min: 0, max: 4 }).map((roll) => roll === 0),
});

const plan: fc.Arbitrary<Plan> = fc.record({
  attempts: fc.uniqueArray(attemptPlan, { maxLength: 5, selector: (one) => one.attemptId }),
  commits: fc.array(fc.record({ removed: fc.boolean(), foreign: fc.boolean(), slot: fc.integer({ min: 0, max: 5 }) }), { maxLength: 3 }),
  authorities: fc.uniqueArray(keyIndex, { maxLength: KEYS.length }),
  supplied: fc.option(keyIndex, { nil: undefined }),
  signer: fc.option(fc.record({ answer: fc.option(keyIndex, { nil: undefined }) }), { nil: undefined }),
  deployedAbove: fc.integer({ min: 0, max: 9 }).map((roll) => roll === 0),
});

const payloadOf = (attempt: AttemptPlan): `0x${string}` => {
  if (attempt.payload === 'foreign') return FOREIGN_PAYLOAD;

  if (attempt.payload === 'trailing') return `${handoverPayload(key(0), key(1))}00`;

  return handoverPayload(attempt.payload === 'zero' ? ZERO : key(attempt.payload), key(attempt.removedIndex));
};

/** The notifications in log order: attempts in plan order, each commit after the attempt its slot names. */
const historyOf = (input: Plan): KitNotification[] => {
  const notes: KitNotification[] = [];
  const pair = (foreign: boolean): { account?: Address } => (foreign ? { account: OTHER_ACCOUNT } : {});
  const commitsAt = (slot: number): void => {
    input.commits.forEach((commit, index) => {
      if (commit.slot === slot) notes.push(committed({ block: 200 + slot * 10 + 5, index, removed: commit.removed }, pair(commit.foreign)));
    });
  };

  commitsAt(0);
  input.attempts.forEach((attempt, index) => {
    const block = 200 + (index + 1) * 10;

    if (attempt.started !== 'none') {
      notes.push(started(attempt.attemptId, payloadOf(attempt), { block, removed: attempt.started === 'removed' }, pair(attempt.foreign)));
    }

    if (attempt.consumed !== 'none') {
      notes.push(consumed(attempt.attemptId, { block: block + 1, removed: attempt.consumed === 'removed' }, pair(attempt.foreign)));
    }

    commitsAt(index + 1);
  });

  for (let slot = input.attempts.length + 1; slot <= 5; slot += 1) commitsAt(slot);

  return notes;
};

const worldOf = (input: Plan, failAt?: number): World => {
  const history = historyOf(input);

  return {
    notifications: { value: history },
    authorities: keySet(...input.authorities.map(key)),
    transactions: nodeFor(history),
    ...(input.signer === undefined ? {} : { signer: { value: input.signer.answer === undefined ? undefined : key(input.signer.answer) } }),
    ...(failAt === undefined ? {} : { failAt }),
  };
};

const rigOf = (input: Plan, failAt?: number): Rig =>
  rig(
    worldOf(input, failAt),
    {
      ...(input.supplied === undefined ? {} : { supplied: key(input.supplied).toLowerCase() as Address }),
      descriptor: { ...DESCRIPTOR, deployedAt: input.deployedAbove ? BLOCK.number + 1 : DESCRIPTOR.deployedAt },
    },
    codec,
  );

/** One read, as compared between runs and against the expectation. */
const shapeOf = (read: Read): string => {
  if (read.kind === 'isAuthority') return `isAuthority ${read.key.toLowerCase()} ${read.block?.number}/${read.block?.hash}`;

  if (read.kind === 'fetch') return `fetch ${read.range.from}-${read.range.to}`;

  if (read.kind === 'transaction') return `transaction ${read.hash.toLowerCase()}`;

  return `recoverSigner ${read.transaction.hash.toLowerCase()} ${read.account.toLowerCase()}`;
};

/** The expected rule, written independently of `src/`: the result and the reads it makes when no read fails. */
const expected = (input: Plan): { result: RemovedKey; reads: string[] } => {
  const reads: string[] = [];
  const allowed = keySet(...input.authorities.map(key));
  const ask = (candidate: Address): boolean => {
    reads.push(`isAuthority ${candidate.toLowerCase()} ${BLOCK.number}/${BLOCK.hash}`);

    return allowed.has(candidate.toLowerCase());
  };
  let denied = false;

  if (input.supplied !== undefined) {
    return { result: ask(key(input.supplied)) ? key(input.supplied) : 'not-a-key', reads };
  }

  const history = input.deployedAbove ? [] : historyOf(input);

  if (!input.deployedAbove) reads.push(`fetch ${DESCRIPTOR.deployedAt}-${BLOCK.number}`);

  const live = history.filter((note) => !note.at.removed && 'account' in note && note.account === ACCOUNT && 'action' in note && note.action === ACTION);
  const startedIds = new Map(live.flatMap((note) => (note.kind === 'attempt-started' ? [[note.attemptId, note] as const] : [])));
  const chosen = live
    .flatMap((note) => (note.kind === 'attempt-consumed' && startedIds.has(note.attemptId) ? [note.attemptId] : []))
    .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))[0];
  const plannedOf = (attemptId: bigint): AttemptPlan | undefined => input.attempts.find((one) => BigInt(one.attemptId) === attemptId);
  const chosenPlan = chosen === undefined ? undefined : plannedOf(chosen);

  if (chosenPlan !== undefined && typeof chosenPlan.payload === 'number') {
    if (ask(key(chosenPlan.payload))) return { result: key(chosenPlan.payload), reads };

    denied = true;
  }

  const lastCommit = live.filter((note) => note.kind === 'setup-committed').at(-1);

  if (input.signer !== undefined && lastCommit !== undefined) {
    reads.push(`transaction ${lastCommit.at.transactionHash.toLowerCase()}`);
    reads.push(`recoverSigner ${lastCommit.at.transactionHash.toLowerCase()} ${ACCOUNT.toLowerCase()}`);

    if (input.signer.answer !== undefined) {
      if (ask(key(input.signer.answer))) return { result: key(input.signer.answer), reads };

      denied = true;
    }
  }

  return { result: denied ? 'not-a-key' : 'no-source', reads };
};

const settle = async (subject: Rig): Promise<{ result: RemovedKey | { rejected: unknown }; reads: string[] }> => {
  try {
    return { result: await inferRemovedKey(subject.inputs, BLOCK), reads: subject.reads.map(shapeOf) };
  } catch (reason) {
    return { result: { rejected: reason }, reads: subject.reads.map(shapeOf) };
  }
};

describe('inferRemovedKey over arbitrary histories', () => {
  it('answers what the rule answers, with the reads the rule makes, and never rejects', async () => {
    await runAsync(
      fc.asyncProperty(plan, async (input) => {
        const actual = await settle(rigOf(input));

        expect(actual).toEqual(expected(input));
      }),
    );
  });

  it('names an address only after isAuthority confirmed it at the pinned block, and the supplied address whenever it is confirmed', async () => {
    await runAsync(
      fc.asyncProperty(plan, async (input) => {
        const subject = rigOf(input);
        const result = await inferRemovedKey(subject.inputs, BLOCK);
        const allowed = keySet(...input.authorities.map(key));

        if (input.supplied !== undefined && allowed.has(key(input.supplied).toLowerCase())) expect(result).toBe(key(input.supplied));

        if (result === 'no-source' || result === 'not-a-key' || result === 'unread') return;

        expect(allowed.has(result.toLowerCase())).toBe(true);
        expect(subject.reads.some((read) => read.kind === 'isAuthority' && read.key.toLowerCase() === result.toLowerCase() && read.block?.number === BLOCK.number && read.block.hash.toLowerCase() === BLOCK.hash)).toBe(true);
        expect(KEYS).toContain(result);
      }),
    );
  });

  it('gives the same result and the same reads twice', async () => {
    await runAsync(
      fc.asyncProperty(plan, async (input) => {
        expect(await settle(rigOf(input))).toEqual(await settle(rigOf(input)));
      }),
    );
  });

  it('answers unread when any read of its own fails and rejects as the supplied key\'s read rejected, reading nothing after it', async () => {
    await runAsync(
      fc.asyncProperty(plan, fc.nat(), async (input, pick) => {
        const clean = await settle(rigOf(input));

        fc.pre(clean.reads.length > 0);

        const failAt = pick % clean.reads.length;
        const failed = await settle(rigOf(input, failAt));
        const suppliedRead = input.supplied !== undefined && failAt === 0;

        expect(failed).toEqual({ result: suppliedRead ? { rejected: INJECTED } : 'unread', reads: clean.reads.slice(0, failAt + 1) });
      }),
    );
  });
});
