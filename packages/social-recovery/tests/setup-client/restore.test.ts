import { describe, expect, it } from 'vitest';
import {
  BACKUP_PADDING_SIZE,
  BACKUP_PAYLOAD_VERSION,
  KitRefusalError,
  sealBackup,
  type Configuration,
  type Hex,
  type RestoreCause,
} from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  BOUND_FILTER,
  build,
  committed,
  configurationOf,
  DRAFT,
  HEADER,
  members,
  noSetupState,
  PIN,
  position,
  referenceCommitment,
  standingState,
  type BuildOptions,
} from './doubles';

const PASSWORD = 'correct horse battery staple';
const CONFIGURATION = configurationOf(DRAFT);
const NONCE = 3n;
const AT_BLOCK = 800;
const COMMITMENT = referenceCommitment(DRAFT, ACCOUNT, ACTION, NONCE);
const CIPHER_NONCE: Hex = `0x${'0f'.repeat(12)}`;

const authenticated = (setupCommitment: Hex = COMMITMENT, nonce: bigint = NONCE) => ({
  account: ACCOUNT,
  action: ACTION,
  setupCommitment,
  nonce,
  payloadVersion: BACKUP_PAYLOAD_VERSION,
});

const seal = (configuration: Configuration = CONFIGURATION, password = PASSWORD, bound = authenticated()): Promise<Hex> =>
  sealBackup(configuration, password, CIPHER_NONCE, BACKUP_PADDING_SIZE, bound);

const SEALED = await seal();
const STANDING = standingState(COMMITMENT, NONCE, AT_BLOCK);

/** The restore cause a rejected `getSetup` carries, failing when the value is not a `KitRefusalError`. */
async function causeOf(promise: Promise<unknown>): Promise<RestoreCause> {
  const thrown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(thrown).toBeInstanceOf(KitRefusalError);

  const cause = (thrown as KitRefusalError).restoreCause;

  expect(cause).toBeDefined();
  expect((thrown as KitRefusalError).findings).toBeUndefined();

  return cause as RestoreCause;
}

const client = (world: BuildOptions['world']) => build({ world });

describe('getSetup with a password', () => {
  it('opens the latest SetupCommitted over the range from setupCommittedAtBlock to the pinned block', async () => {
    const { client: setup, seen } = client({ state: STANDING, bound: [committed(NONCE, COMMITMENT, SEALED, position(AT_BLOCK))] });

    expect(await setup.getSetup({ password: PASSWORD })).toEqual(CONFIGURATION);
    expect(seen.blockTags).toEqual(['latest']);
    expect(seen.fetches).toEqual([{ filter: BOUND_FILTER, range: { from: AT_BLOCK, to: HEADER.number } }]);
    expect(seen.parts.filter((part) => part.member === 'stateOf').map((part) => part.args[0])).toEqual([PIN]);
  });

  it("refuses with 'no-setup' and reads no event where no setup stands", async () => {
    const { client: setup, seen } = client({ state: noSetupState(4n, 900) });
    const cause = await causeOf(setup.getSetup({ password: PASSWORD }));

    expect(cause.code).toBe('restore.no-backup');
    expect(cause.values).toMatchObject({ case: 'no-setup' });
    expect(seen.fetches).toEqual([]);
  });

  it("refuses with 'no-backup-kept' and the nonce where the event's private metadata is empty", async () => {
    const { client: setup } = client({ state: STANDING, bound: [committed(NONCE, COMMITMENT, '0x', position(AT_BLOCK))] });
    const cause = await causeOf(setup.getSetup({ password: PASSWORD }));

    expect(cause).toEqual({
      code: 'restore.no-backup',
      subject: 'restore',
      values: { account: ACCOUNT, action: ACTION, case: 'no-backup-kept', nonce: NONCE },
    });
  });

  it("refuses with 'no-backup-kept' where the range holds no SetupCommitted", async () => {
    const cause = await causeOf(client({ state: STANDING, bound: [] }).client.getSetup({ password: PASSWORD }));

    expect(cause.values).toMatchObject({ case: 'no-backup-kept', nonce: NONCE });
  });

  it("refuses with 'no-backup-kept' where the highest event is not the setup stateOf confirms", async () => {
    const stale = committed(NONCE - 1n, `0x${'01'.repeat(32)}`, SEALED, position(AT_BLOCK));
    const cause = await causeOf(client({ state: STANDING, bound: [stale] }).client.getSetup({ password: PASSWORD }));

    expect(cause.values).toMatchObject({ case: 'no-backup-kept' });
  });

  it('takes the highest nonce, whatever the list order', async () => {
    const older = committed(NONCE - 1n, `0x${'01'.repeat(32)}`, '0x', position(AT_BLOCK + 5));
    const current = committed(NONCE, COMMITMENT, SEALED, position(AT_BLOCK));

    expect(await client({ state: STANDING, bound: [current, older] }).client.getSetup({ password: PASSWORD })).toEqual(CONFIGURATION);
  });

  it('breaks a nonce tie by log order, the later event winning', async () => {
    const early = committed(NONCE, COMMITMENT, '0x', position(AT_BLOCK, 0));
    const late = committed(NONCE, COMMITMENT, SEALED, position(AT_BLOCK, 1));

    expect(await client({ state: STANDING, bound: [early, late] }).client.getSetup({ password: PASSWORD })).toEqual(CONFIGURATION);

    const cause = await causeOf(
      client({
        state: STANDING,
        bound: [committed(NONCE, COMMITMENT, SEALED, position(AT_BLOCK, 0)), committed(NONCE, COMMITMENT, '0x', position(AT_BLOCK, 1))],
      }).client.getSetup({ password: PASSWORD }),
    );

    expect(cause.values).toMatchObject({ case: 'no-backup-kept' });
  });

  it('ignores a removed event', async () => {
    const current = committed(NONCE, COMMITMENT, SEALED, position(AT_BLOCK));
    const removed = committed(NONCE, COMMITMENT, '0x', position(AT_BLOCK, 1, true));

    expect(await client({ state: STANDING, bound: [current, removed] }).client.getSetup({ password: PASSWORD })).toEqual(CONFIGURATION);
  });

  it.each([
    ['a wrong password', async () => SEALED, 'not the password'],
    ['damaged bytes', async () => `${SEALED.slice(0, -2)}${SEALED.endsWith('00') ? '01' : '00'}` as Hex, PASSWORD],
    ['a backup of another setup nonce', async () => seal(CONFIGURATION, PASSWORD, authenticated(COMMITMENT, NONCE - 1n)), PASSWORD],
    ['a truncated payload', async () => SEALED.slice(0, 40) as Hex, PASSWORD],
  ])('refuses %s as backup-unopened with the payload size and the five values', async (_name, payload, password) => {
    const bytes = await payload();
    const cause = await causeOf(
      client({ state: STANDING, bound: [committed(NONCE, COMMITMENT, bytes, position(AT_BLOCK))] }).client.getSetup({ password }),
    );

    expect(cause).toEqual({
      code: 'restore.backup-unopened',
      subject: 'restore',
      values: { payloadSize: (bytes.length - 2) / 2, authenticated: authenticated() },
    });
  });

  it('refuses a backup that opens but does not recompute to the committed commitment', async () => {
    const otherCommitment: Hex = `0x${'0d'.repeat(32)}`;
    const sealed = await seal(CONFIGURATION, PASSWORD, authenticated(otherCommitment));
    const cause = await causeOf(
      client({
        state: standingState(otherCommitment, NONCE, AT_BLOCK),
        bound: [committed(NONCE, otherCommitment, sealed, position(AT_BLOCK))],
      }).client.getSetup({ password: PASSWORD }),
    );

    expect(cause).toEqual({
      code: 'restore.commitment-mismatch',
      subject: 'restore',
      values: { recomputed: COMMITMENT, committed: otherCommitment },
    });
  });

  it.each([
    ['the block read', { header: { rejects: new Error('down') } }],
    ['stateOf', { state: { rejects: new Error('down') } }],
    ['fetch', { state: STANDING, bound: { rejects: new Error('down') } }],
  ] as const)('passes a transport failure of %s through as itself', async (_name, world) => {
    const thrown = await client(world as BuildOptions['world'])
      .client.getSetup({ password: PASSWORD })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(thrown).not.toBeInstanceOf(KitRefusalError);
    expect((thrown as Error).message).toBe('down');
  });
});

describe('getSetup with the configuration', () => {
  it('pins a block, reads stateOf, fetches no event and returns the configuration that recomputes', async () => {
    const { client: setup, seen } = client({ state: STANDING });

    expect(await setup.getSetup(CONFIGURATION)).toEqual(CONFIGURATION);
    expect(seen.blockTags).toEqual(['latest']);
    expect(seen.fetches).toEqual([]);
    expect(members(seen)).toContain('manager.stateOf');
  });

  it("refuses with 'no-setup' where no setup stands", async () => {
    const cause = await causeOf(client({ state: noSetupState(2n, 10) }).client.getSetup(CONFIGURATION));

    expect(cause.values).toMatchObject({ case: 'no-setup' });
  });

  it('refuses a configuration that does not recompute', async () => {
    const cause = await causeOf(client({ state: STANDING }).client.getSetup({ ...CONFIGURATION, wait: CONFIGURATION.wait + 1 }));

    expect(cause.code).toBe('restore.commitment-mismatch');
    expect(cause.values).toMatchObject({ committed: COMMITMENT });
  });
});
