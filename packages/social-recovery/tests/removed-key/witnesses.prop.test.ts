import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AmbireActionCodec, inferRemovedKey, REMOVED_KEY_UNNAMED, type Address, type KitNotification, type RemovedKey } from '../../src/index';
import { removedKeyReading } from '../../src/removed-key/infer';
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
  key,
  KEYS,
  OTHER_ACCOUNT,
  positionAt,
  PRIV_KEY,
  PRIV_NONE,
  PRIV_SLOT,
  privilege,
  PRIVILEGE_FILTER,
  rig,
  started,
  transactionAt,
  ZERO,
  type Outcome,
  type Rig,
  type World,
} from './doubles';

const codec = new AmbireActionCodec([ACTION]);

/** How `isAuthority` answers for one key: confirmed, denied, a rejection, or no boolean. */
type Verdict = 'yes' | 'no' | 'rejects' | 'odd';

type WritePlan = {
  readonly addr: number | 'malformed';
  readonly priv: 'key' | 'slot' | 'none';
  readonly removed: boolean;
  readonly foreign: boolean;
  readonly block: number;
  readonly index: number;
};

type SeamPlan = { readonly transaction: 'known' | 'rejects' | 'unknown'; readonly signer: number | 'none' | 'rejects' | 'malformed' };

type Plan = {
  readonly handover: number | 'zero' | 'foreign' | undefined;
  readonly commit: boolean;
  readonly seam: SeamPlan | undefined;
  readonly writes: readonly WritePlan[];
  readonly scan: 'answers' | 'rejects' | 'malformed';
  readonly verdicts: readonly Verdict[];
  readonly supplied: number | undefined;
  readonly deployedAbove: boolean;
};

const keyIndex = fc.integer({ min: 0, max: KEYS.length - 1 });
const rare = (odds: number): fc.Arbitrary<boolean> => fc.integer({ min: 0, max: odds - 1 }).map((roll) => roll === 0);

const writePlan: fc.Arbitrary<WritePlan> = fc.record({
  addr: fc.oneof({ weight: 9, arbitrary: keyIndex }, { weight: 1, arbitrary: fc.constant('malformed' as const) }),
  priv: fc.constantFrom('key', 'key', 'slot', 'none'),
  removed: rare(5),
  foreign: rare(5),
  block: fc.integer({ min: DESCRIPTOR.deployedAt, max: BLOCK.number }),
  index: fc.integer({ min: 0, max: 3 }),
});

const plan: fc.Arbitrary<Plan> = fc.record({
  handover: fc.oneof(keyIndex, fc.constantFrom<Plan['handover']>(undefined, 'zero', 'foreign')),
  commit: fc.boolean(),
  seam: fc.option(
    fc.record({
      transaction: fc.constantFrom<SeamPlan['transaction']>('known', 'known', 'known', 'rejects', 'unknown'),
      signer: fc.oneof({ weight: 6, arbitrary: keyIndex }, { weight: 1, arbitrary: fc.constantFrom<SeamPlan['signer']>('none', 'rejects', 'malformed') }),
    }),
    { nil: undefined },
  ),
  writes: fc.uniqueArray(writePlan, { maxLength: 6, selector: (one) => `${one.block}/${one.index}` }),
  scan: fc.constantFrom<Plan['scan']>('answers', 'answers', 'answers', 'answers', 'rejects', 'malformed'),
  verdicts: fc.array(fc.constantFrom<Verdict>('yes', 'yes', 'no', 'no', 'rejects', 'odd'), { minLength: KEYS.length, maxLength: KEYS.length }),
  supplied: fc.oneof({ weight: 5, arbitrary: fc.constant(undefined) }, { weight: 1, arbitrary: keyIndex }),
  deployedAbove: rare(10),
});

const PRIVS = { key: PRIV_KEY, slot: PRIV_SLOT, none: PRIV_NONE } as const;
const COMMIT_AT = positionAt({ block: 300 });
const DOWN = new Error('down');

const verdictOf = (input: Plan, candidate: Address): Verdict => input.verdicts[KEYS.indexOf(candidate)] ?? 'no';

const historyOf = (input: Plan): KitNotification[] => {
  const notes: KitNotification[] = [];

  if (input.handover !== undefined) {
    const payload = input.handover === 'foreign' ? FOREIGN_PAYLOAD : handoverPayload(input.handover === 'zero' ? ZERO : key(input.handover), key(5));

    notes.push(started(3, payload, { block: 200 }), consumed(3, { block: 201 }));
  }

  if (input.commit) notes.push(committed({ block: 300 }));

  return notes;
};

const writesOf = (input: Plan): KitNotification[] =>
  input.writes.map((write) =>
    privilege(
      write.addr === 'malformed' ? ('0xnot-an-address' as Address) : key(write.addr),
      PRIVS[write.priv],
      { block: write.block, index: write.index, removed: write.removed },
      write.foreign ? OTHER_ACCOUNT : ACCOUNT,
    ),
  );

const keysWith = (input: Plan, verdict: Verdict): string[] => KEYS.filter((one) => verdictOf(input, one) === verdict).map((one) => one.toLowerCase());

const signerOutcome = (signer: SeamPlan['signer']): Outcome<Address | undefined> => {
  if (signer === 'none') return { value: undefined };

  if (signer === 'rejects') return { rejects: DOWN };

  return { value: signer === 'malformed' ? ('nope' as Address) : key(signer) };
};

const rigOf = (input: Plan): Rig => {
  const scans: Record<Plan['scan'], Outcome<readonly KitNotification[]>> = {
    answers: { value: writesOf(input) },
    rejects: { rejects: DOWN },
    malformed: { value: { length: 1 } as never },
  };
  const node: Record<SeamPlan['transaction'], World['transactions']> = {
    known: new Map([[COMMIT_AT.transactionHash.toLowerCase(), { value: transactionAt(COMMIT_AT) }]]),
    rejects: new Map([[COMMIT_AT.transactionHash.toLowerCase(), { rejects: DOWN }]]),
    unknown: new Map(),
  };
  const world: World = {
    notifications: { value: historyOf(input) },
    privileges: scans[input.scan],
    authorities: new Set(keysWith(input, 'yes')),
    authorityRejects: new Map(keysWith(input, 'rejects').map((one) => [one, DOWN])),
    authorityAnswers: new Map(keysWith(input, 'odd').map((one) => [one, 'true'])),
    ...(input.seam === undefined ? {} : { transactions: node[input.seam.transaction], signer: signerOutcome(input.seam.signer) }),
  };

  return rig(
    world,
    {
      ...(input.supplied === undefined ? {} : { supplied: key(input.supplied) }),
      descriptor: { ...DESCRIPTOR, deployedAt: input.deployedAbove ? BLOCK.number + 1 : DESCRIPTOR.deployedAt },
    },
    codec,
  );
};

type Walk = { readonly answer: RemovedKey | 'rejects'; readonly fromHandover: boolean; readonly asked: readonly Address[] };

/** Today's walk, written independently of `src/`: the supplied key alone, else step 1 then step 2, stopping at a confirmed key or a failed read. */
const walkOf = (input: Plan): Walk => {
  const asked: Address[] = [];
  const ask = (candidate: Address): Verdict => {
    asked.push(candidate);

    return verdictOf(input, candidate);
  };

  if (input.supplied !== undefined) {
    const verdict = ask(key(input.supplied));
    const answers = { yes: key(input.supplied), no: 'not-a-key', rejects: 'rejects', odd: 'unread' } as const;

    return { answer: answers[verdict], fromHandover: false, asked };
  }

  if (input.deployedAbove) return { answer: 'no-source', fromHandover: false, asked };

  let denied = false;

  if (typeof input.handover === 'number') {
    const verdict = ask(key(input.handover));

    if (verdict === 'yes') return { answer: key(input.handover), fromHandover: true, asked };

    if (verdict !== 'no') return { answer: 'unread', fromHandover: false, asked };

    denied = true;
  }

  if (input.seam !== undefined && input.commit) {
    const { signer } = input.seam;

    if (input.seam.transaction !== 'known' || signer === 'rejects' || signer === 'malformed') return { answer: 'unread', fromHandover: false, asked };

    if (signer !== 'none') {
      const verdict = ask(key(signer));

      if (verdict === 'yes') return { answer: key(signer), fromHandover: false, asked };

      if (verdict !== 'no') return { answer: 'unread', fromHandover: false, asked };

      denied = true;
    }
  }

  return { answer: denied ? 'not-a-key' : 'no-source', fromHandover: false, asked };
};

/** The addresses read beside the walk's key, in candidate order: the setup signer where step 1 named the key, then each address whose last live write of the bound account is nonzero, by that write's position. */
const witnessesOf = (input: Plan, fromHandover: boolean): Address[] => {
  const found: Address[] = [];
  const { seam } = input;

  if (fromHandover && seam !== undefined && input.commit && seam.transaction === 'known' && typeof seam.signer === 'number') found.push(key(seam.signer));

  if (input.scan !== 'answers') return found;

  const live = input.writes.filter((write) => !write.removed && !write.foreign).sort((left, right) => left.block - right.block || left.index - right.index);
  const last = new Map<number, WritePlan>();

  for (const write of live) {
    if (write.addr === 'malformed') continue;

    last.delete(write.addr);
    last.set(write.addr, write);
  }

  for (const [addr, write] of last) if (write.priv !== 'none') found.push(key(addr));

  return found;
};

const isAddress = (answer: RemovedKey | 'rejects'): answer is Address => answer !== 'rejects' && !(REMOVED_KEY_UNNAMED as readonly string[]).includes(answer);

/** The rule: today's answer, unless a second confirmed address stands beside a key named without a supplied address. */
const expectedOf = (input: Plan): { reading: { key: RemovedKey; candidates: Address[] } | 'rejects'; asked: Set<string>; scanned: boolean } => {
  const walk = walkOf(input);
  const asked = new Set(walk.asked.map((one) => one.toLowerCase()));

  if (walk.answer === 'rejects') return { reading: 'rejects', asked, scanned: false };

  if (!isAddress(walk.answer) || input.supplied !== undefined) return { reading: { key: walk.answer, candidates: [] }, asked, scanned: false };

  const named = walk.answer;
  const others = witnessesOf(input, walk.fromHandover).filter((one) => one !== named);

  for (const one of others) asked.add(one.toLowerCase());

  const confirmed = others.filter((one) => verdictOf(input, one) === 'yes');
  const reading = confirmed.length === 0 ? { key: named, candidates: [] } : { key: 'ambiguous' as const, candidates: [...new Set([named, ...confirmed])] };

  return { reading, asked, scanned: true };
};

const settle = async (subject: Rig): Promise<{ key: RemovedKey; candidates: readonly Address[] } | 'rejects'> => {
  try {
    return await removedKeyReading(subject.inputs, BLOCK);
  } catch (reason) {
    expect(reason).toBe(DOWN);

    return 'rejects';
  }
};

describe('the removed-key reading over arbitrary histories, privilege writes, seams and authority answers', () => {
  it('answers today\'s walk unless a second confirmed address stands beside its key, then ambiguous with every confirmed address, the key first', async () => {
    await runAsync(
      fc.asyncProperty(plan, async (input) => {
        const actual = await settle(rigOf(input));

        expect(actual).toEqual(expectedOf(input).reading);

        if (actual !== 'rejects') await expect(inferRemovedKey(rigOf(input).inputs, BLOCK)).resolves.toBe(actual.key);
      }),
    );
  });

  it('asks the walk\'s keys and every other witness at the pinned block, and scans the privilege filter once only beside a named key', async () => {
    await runAsync(
      fc.asyncProperty(plan, async (input) => {
        const subject = rigOf(input);

        await settle(subject);

        const rule = expectedOf(input);
        const asked = subject.reads.flatMap((read) => (read.kind === 'isAuthority' ? [read] : []));
        const scans = subject.reads.filter((read) => read.kind === 'fetch' && read.filter === PRIVILEGE_FILTER);

        expect(new Set(asked.map((read) => read.key.toLowerCase()))).toEqual(rule.asked);

        for (const read of asked) expect(read.block).toEqual(BLOCK);

        expect(scans).toEqual(rule.scanned ? [{ kind: 'fetch', filter: PRIVILEGE_FILTER, range: { from: DESCRIPTOR.deployedAt, to: BLOCK.number } }] : []);
      }),
    );
  });
});
