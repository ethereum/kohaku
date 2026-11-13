import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Address, BlockRange, RawLog } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  eventLog,
  makeReader,
  MALFORMED_OWNED,
  MANAGER,
  positionOfLog,
  providerDouble,
  rawLog,
  STRANGER,
  thrownBy,
} from './fixture';

const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 256);
const seedText = process.env['FC_SEED'];
const params: fc.Parameters<unknown> = seedText === undefined ? { numRuns } : { numRuns, seed: Number(seedText) };

/** A per-test timeout that grows with the run count, never below vitest's 5 s default. */
const TIMEOUT = Math.max(5_000, numRuns * 10);

const VALID = eventLog(MANAGER, 'AttemptConsumed', { account: ACCOUNT, action: ACTION, attemptId: 7n });
const MALFORMED = MALFORMED_OWNED.map(([, make]) => make({}));
/** What `decodeLog` throws on each malformed template; a log's position takes no part in it. */
const MALFORMED_THROWN = MALFORMED.map((log) => thrownBy(log) as Error);
const UNKNOWN_TOPIC = rawLog(ACCOUNT, [`0x${'ee'.repeat(32)}`, `0x${'00'.repeat(32)}`], '0x');

/** What one generated log is: decodable, owned but undecodable, undecodable from a stranger, or owned with a foreign topic0. */
const role = fc.oneof(
  fc.constant({ role: 'valid' as const }),
  fc.record({ role: fc.constant('malformed' as const), which: fc.nat({ max: MALFORMED.length - 1 }) }),
  fc.record({ role: fc.constant('foreign' as const), which: fc.nat({ max: MALFORMED.length - 1 }) }),
  fc.constant({ role: 'unknown-topic' as const }),
);

type Role = typeof role extends fc.Arbitrary<infer T> ? T : never;

const entry = fc.record({ role, removed: fc.constantFrom(undefined, true, false) });

const scenario = fc.record({
  from: fc.nat({ max: 50 }),
  length: fc.integer({ min: 1, max: 16 }),
  width: fc.integer({ min: 1, max: 6 }),
  blocks: fc.array(fc.array(entry, { maxLength: 3 }), { minLength: 16, maxLength: 16 }),
  order: fc.constantFrom('log', 'reversed', 'interleaved'),
});

type Scenario = typeof scenario extends fc.Arbitrary<infer T> ? T : never;

/** The template a role's log copies, and the address it is emitted from. */
const templateOf = (kind: Role): { readonly template: RawLog; readonly address: Address } => {
  if (kind.role === 'valid') return { template: VALID, address: VALID.address };

  if (kind.role === 'unknown-topic') return { template: UNKNOWN_TOPIC, address: ACCOUNT };

  const template = MALFORMED[kind.which] as RawLog;

  return { template, address: kind.role === 'malformed' ? template.address : STRANGER };
};

/** The chunks a range of the width reads, written out independently of the reader. */
const chunksOf = (range: BlockRange, width: number): BlockRange[] => {
  const chunks: BlockRange[] = [];

  for (let from = range.from; from <= range.to; from += width) chunks.push({ from, to: Math.min(from + width - 1, range.to) });

  return chunks;
};

/** The logs in the order a provider answers them. */
const reorder = (logs: readonly RawLog[], order: string): RawLog[] => {
  if (order === 'reversed') return [...logs].reverse();

  if (order === 'interleaved') return [...logs.filter((_, index) => index % 2 === 1), ...logs.filter((_, index) => index % 2 === 0)];

  return [...logs];
};

const byPlace = (left: RawLog, right: RawLog): number => left.blockNumber - right.blockNumber || left.logIndex - right.logIndex;

describe('fetch over any mix of decodable, undecodable and foreign logs', () => {
  it(
    'resolves every decodable owned log as a notification and every undecodable owned log as a skipped entry, both in log order, reading each chunk once',
    async () => {
      await fc.assert(
        fc.asyncProperty(scenario, async ({ from, length, width, blocks, order }) => {
          const range = { from, to: from + length - 1 };
          const logs: { readonly log: RawLog; readonly kind: Role }[] = [];

          for (let offset = 0; offset < length; offset += 1) {
            (blocks[offset] ?? []).forEach(({ role: kind, removed }, logIndex) => {
              const { template, address } = templateOf(kind);
              const place = { blockNumber: from + offset, logIndex, ...(removed === undefined ? {} : { removed }) };

              logs.push({ log: rawLog(address, template.topics, template.data, place), kind });
            });
          }

          const provider = providerDouble(async (chunk) =>
            reorder(
              logs.map(({ log }) => log).filter((log) => log.blockNumber >= chunk.from && log.blockNumber <= chunk.to),
              order,
            ),
          );
          const { notifications, skipped } = await makeReader(provider, width).fetch(makeReader().accountFilter(), range);
          const valid = logs.filter(({ kind }) => kind.role === 'valid').map(({ log }) => log).sort(byPlace);
          const malformed = logs.filter(({ kind }) => kind.role === 'malformed').sort((left, right) => byPlace(left.log, right.log));

          expect(notifications).toEqual(
            valid.map((log) => ({ kind: 'attempt-consumed', account: ACCOUNT, action: ACTION, attemptId: 7n, at: positionOfLog(log) })),
          );
          expect(skipped).toHaveLength(malformed.length);
          skipped.forEach((skip, index) => {
            const { log, kind } = malformed[index] as (typeof malformed)[number];
            const thrown = MALFORMED_THROWN[kind.role === 'malformed' ? kind.which : -1] as Error;

            expect(skip.log).toBe(log);
            expect(skip.at).toEqual(positionOfLog(log));
            expect((skip.error as Error).constructor).toBe(thrown.constructor);
            expect((skip.error as Error).message).toBe(thrown.message);
          });
          expect(provider.calls.map((call) => call.range)).toEqual(chunksOf(range, width));
        }),
        params as fc.Parameters<[Scenario]>,
      );
    },
    TIMEOUT,
  );
});
