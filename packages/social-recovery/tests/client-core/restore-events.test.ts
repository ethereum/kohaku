import { describe, expect, it } from 'vitest';
import { KitRefusalError, restoreConfiguration, type Hex, type RawLog } from '../../src/index';
import { readVector } from '../kat/read-vector';
import { managerLog, realEvents, setupCommittedLog } from './event-manager';
import { ACCOUNT, ACTION, actionState, BLOCK as FAR_BLOCK } from './support';

type EventRow = {
  readonly input: { readonly nonce: string; readonly setupCommitment?: Hex; readonly privateMetadata?: Hex };
  readonly expected: { readonly topics: readonly Hex[]; readonly data: Hex };
};

const eventRows = readVector('manager-events.json').vectors;

const eventRow = (name: string): EventRow => {
  const row = eventRows.find((candidate) => candidate['id'] === name);

  if (row === undefined) throw new Error(`no vector row ${name}`);

  return row as unknown as EventRow;
};

const committedRow = eventRow('SetupCommitted');
const clearedRow = eventRow('SetupCleared');
const ROW_COMMITMENT = committedRow.input.setupCommitment as Hex;
const ROW_NONCE = BigInt(committedRow.input.nonce);
/** A pinned block near the logs, so the real reader walks a few chunks. */
const BLOCK = { number: 2_500, hash: FAR_BLOCK.hash };
const PASSWORD = { password: 'correct horse battery staple' };

const rowLog = (row: EventRow, blockNumber: number, removed?: boolean): RawLog =>
  managerLog(row.expected.topics, row.expected.data, { blockNumber, ...(removed === undefined ? {} : { removed }) });

async function causeOf(logs: readonly RawLog[], nonce: bigint, from = 100): Promise<unknown> {
  const { manager } = realEvents(logs);
  const thrown = await restoreConfiguration(manager, ACCOUNT, ACTION, PASSWORD, actionState(ROW_COMMITMENT, nonce, from), BLOCK).then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(thrown).toBeInstanceOf(KitRefusalError);

  return (thrown as KitRefusalError).restoreCause;
}

describe('restoreConfiguration over a real EventManager and the vector logs', () => {
  it('the independent encoder reproduces the SetupCommitted row', () => {
    const log = setupCommittedLog(ROW_NONCE, ROW_COMMITMENT, committedRow.input.privateMetadata as Hex, { blockNumber: 1 });

    expect(log.topics).toEqual(committedRow.expected.topics);
    expect(log.data).toBe(committedRow.expected.data);
  });

  it('selects the SetupCommitted row and refuses its two-byte payload as unopened', async () => {
    const cause = await causeOf([rowLog(committedRow, 100)], ROW_NONCE);

    expect(cause).toStrictEqual({
      code: 'restore.backup-unopened',
      subject: 'restore',
      values: {
        payloadSize: 2,
        authenticated: { account: ACCOUNT, action: ACTION, setupCommitment: ROW_COMMITMENT, nonce: ROW_NONCE, payloadVersion: 1 },
      },
    });
  });

  it('refuses no-backup-kept when a later SetupCleared moved the nonce past the committed row', async () => {
    const cause = await causeOf([rowLog(committedRow, 100), rowLog(clearedRow, 101)], ROW_NONCE + 1n);

    expect(cause).toStrictEqual({
      code: 'restore.no-backup',
      subject: 'restore',
      values: { account: ACCOUNT, action: ACTION, case: 'no-backup-kept', nonce: ROW_NONCE + 1n },
    });
  });

  it('drops the row when the client library reported it removed', async () => {
    const cause = await causeOf([rowLog(committedRow, 100, true)], ROW_NONCE);

    expect(cause).toMatchObject({ code: 'restore.no-backup', values: { case: 'no-backup-kept' } });
  });

  it('reads only the range from setupCommittedAtBlock to the pinned block', async () => {
    const { manager, ranges } = realEvents([rowLog(committedRow, 99)]);
    const thrown = await restoreConfiguration(manager, ACCOUNT, ACTION, PASSWORD, actionState(ROW_COMMITMENT, ROW_NONCE, 100), BLOCK).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect((thrown as KitRefusalError).restoreCause).toMatchObject({ values: { case: 'no-backup-kept' } });
    expect(ranges[0]?.from).toBe(100);
    expect(ranges.at(-1)?.to).toBe(BLOCK.number);
  });

  it('selects the highest nonce across two committed logs in either block order', async () => {
    const older = setupCommittedLog(ROW_NONCE - 1n, ROW_COMMITMENT, '0x', { blockNumber: 101 });
    const cause = await causeOf([rowLog(committedRow, 100), older], ROW_NONCE);

    expect(cause).toMatchObject({ code: 'restore.backup-unopened', values: { payloadSize: 2 } });
  });
});
