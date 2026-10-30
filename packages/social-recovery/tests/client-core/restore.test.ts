import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  KitRefusalError,
  restoreConfiguration,
  serializeConfiguration,
  setupStands,
  type ActionState,
  type Configuration,
  type ConfigurationSource,
  type Hex,
  type KitNotification,
  type PinnedBlock,
  type RestoreCause,
} from '../../src/index';
import {
  ACCOUNT,
  ACCOUNT_BAD_CHECKSUM,
  ACCOUNT_FILTER,
  ACCOUNT_MIXED,
  ACTION,
  actionState,
  BLOCK,
  cleared,
  committed,
  CONFIGURATION,
  eventsDouble,
  position,
  referenceConfigurationCommitment,
  ZERO_WORD,
} from './support';

const NONCE = 7n;
const COMMITMENT = referenceConfigurationCommitment(CONFIGURATION, ACCOUNT, ACTION, NONCE);
const STATE = actionState(COMMITMENT, NONCE, 100);
const PASSWORD: ConfigurationSource = { password: 'correct horse battery staple' };
/** A payload of the wrong length: the `privateMetadata` of the manager-events `SetupCommitted` row. */
const SHORT_PAYLOAD: Hex = '0x1234';

/** Awaits a restore expected to refuse and returns the refusal. */
async function refusal(promise: Promise<unknown>): Promise<KitRefusalError> {
  const thrown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(thrown).toBeInstanceOf(KitRefusalError);

  return thrown as KitRefusalError;
}

const restore = (
  notifications: readonly KitNotification[],
  source: ConfigurationSource = PASSWORD,
  state: ActionState = STATE,
  block: PinnedBlock = BLOCK,
) => {
  const double = eventsDouble(notifications);

  return { double, result: restoreConfiguration(double.events, ACCOUNT, ACTION, source, state, block) };
};

const noBackupKept: RestoreCause = {
  code: 'restore.no-backup',
  subject: 'restore',
  values: { account: ACCOUNT, action: ACTION, case: 'no-backup-kept', nonce: NONCE },
};

const unopened = (payloadSize: number, state: ActionState = STATE): RestoreCause => ({
  code: 'restore.backup-unopened',
  subject: 'restore',
  values: {
    payloadSize,
    authenticated: { account: ACCOUNT, action: ACTION, setupCommitment: state.setupCommitment, nonce: state.setupNonce, payloadVersion: 1 },
  },
});

describe('setupStands', () => {
  it('is false on the zero word and true on any other commitment', () => {
    expect(setupStands(actionState(ZERO_WORD, 0n))).toBe(false);
    expect(setupStands(actionState(ZERO_WORD, 5n))).toBe(false);
    expect(setupStands(actionState(`0x${'00'.repeat(31)}01`, 0n))).toBe(true);
    expect(setupStands(STATE)).toBe(true);
  });
});

describe('restoreConfiguration with no setup standing', () => {
  it.each([
    ['a password', PASSWORD],
    ['a configuration', CONFIGURATION],
  ] as const)('refuses no-setup without a nonce and fetches nothing, from %s', async (_, source) => {
    const { double, result } = restore([committed(NONCE, COMMITMENT, SHORT_PAYLOAD)], source, actionState(ZERO_WORD, 3n));
    const error = await refusal(result);

    expect(error.restoreCause).toStrictEqual({
      code: 'restore.no-backup',
      subject: 'restore',
      values: { account: ACCOUNT, action: ACTION, case: 'no-setup' },
    });
    expect(double.fetches).toEqual([]);
    expect(error.findings).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });
});

describe('restoreConfiguration from a password: the read', () => {
  it('fetches once over the bound account filter from setupCommittedAtBlock to the pinned block', async () => {
    const { double, result } = restore([], PASSWORD, actionState(COMMITMENT, NONCE, 4_321));

    await refusal(result);
    expect(double.fetches).toEqual([{ filter: ACCOUNT_FILTER, range: { from: 4_321, to: BLOCK.number } }]);
    expect(double.filterOptions.every((options) => options?.allActions !== true)).toBe(true);
    expect(double.others).toEqual([]);
  });

  it('reads a single-block range when the setup was written at the pinned block', async () => {
    const { double, result } = restore([], PASSWORD, actionState(COMMITMENT, NONCE, BLOCK.number));

    await refusal(result);
    expect(double.fetches[0]?.range).toEqual({ from: BLOCK.number, to: BLOCK.number });
  });

  it('propagates a fetch rejection as the same value, never a refusal', async () => {
    const failure = new Error('logs unavailable');
    const double = eventsDouble({ rejects: failure });

    await expect(restoreConfiguration(double.events, ACCOUNT, ACTION, PASSWORD, STATE, BLOCK)).rejects.toBe(failure);
  });

  it('propagates a non-Error fetch rejection as the same value', async () => {
    const failure = { code: -32_000, message: 'timeout' };
    const double = eventsDouble({ rejects: failure });

    await expect(restoreConfiguration(double.events, ACCOUNT, ACTION, PASSWORD, STATE, BLOCK)).rejects.toBe(failure);
  });
});

describe('restoreConfiguration from a password: selecting the event', () => {
  it('refuses no-backup-kept with the stored nonce when no setup-committed is in the range', async () => {
    const error = await refusal(restore([]).result);

    expect(error.restoreCause).toStrictEqual(noBackupKept);
  });

  it('refuses no-backup-kept when only clears are in the range', async () => {
    const error = await refusal(restore([cleared(NONCE)]).result);

    expect(error.restoreCause).toStrictEqual(noBackupKept);
  });

  it('refuses no-backup-kept when the highest event carries another nonce', async () => {
    const error = await refusal(restore([committed(NONCE - 1n, COMMITMENT, SHORT_PAYLOAD)]).result);

    expect(error.restoreCause).toStrictEqual(noBackupKept);
  });

  it('refuses no-backup-kept when a higher nonce than the stored one sits in the range', async () => {
    const notifications = [committed(NONCE, COMMITMENT, SHORT_PAYLOAD, position(100)), committed(NONCE + 1n, COMMITMENT, SHORT_PAYLOAD, position(101))];
    const error = await refusal(restore(notifications).result);

    expect(error.restoreCause).toStrictEqual(noBackupKept);
  });

  it('refuses no-backup-kept when the highest event carries another commitment', async () => {
    const error = await refusal(restore([committed(NONCE, `0x${'cd'.repeat(32)}`, SHORT_PAYLOAD)]).result);

    expect(error.restoreCause).toStrictEqual(noBackupKept);
  });

  it('refuses no-backup-kept when the selected event kept an empty privateMetadata', async () => {
    const error = await refusal(restore([committed(NONCE, COMMITMENT, '0x')]).result);

    expect(error.restoreCause).toStrictEqual(noBackupKept);
  });

  it('compares the commitment without regard to case', async () => {
    const upper = `0x${COMMITMENT.slice(2).toUpperCase()}` as Hex;
    const error = await refusal(restore([committed(NONCE, upper, SHORT_PAYLOAD)]).result);

    expect(error.restoreCause?.code).toBe('restore.backup-unopened');
  });

  it.each([
    ['ascending', [5n, 6n, 7n]],
    ['descending', [7n, 6n, 5n]],
    ['shuffled', [6n, 7n, 5n]],
  ] as const)('selects the highest nonce whatever the order (%s)', async (_, nonces) => {
    const notifications = nonces.map((eventNonce, index) =>
      committed(eventNonce, eventNonce === NONCE ? COMMITMENT : `0x${'ee'.repeat(32)}`, eventNonce === NONCE ? SHORT_PAYLOAD : '0x', position(100 + index)),
    );
    const error = await refusal(restore(notifications).result);

    expect(error.restoreCause).toStrictEqual(unopened(2));
  });

  it('does not fall back to an older event when the highest kept no backup', async () => {
    const notifications = [committed(NONCE - 1n, COMMITMENT, SHORT_PAYLOAD, position(100)), committed(NONCE, COMMITMENT, '0x', position(101))];
    const error = await refusal(restore(notifications).result);

    expect(error.restoreCause).toStrictEqual(noBackupKept);
  });

  it('drops a removed log before selecting', async () => {
    const notifications = [
      committed(NONCE, COMMITMENT, SHORT_PAYLOAD, position(100)),
      committed(NONCE + 1n, COMMITMENT, '0x', position(101, 0, true)),
    ];
    const error = await refusal(restore(notifications).result);

    expect(error.restoreCause).toStrictEqual(unopened(2));
  });

  it('refuses no-backup-kept when the only matching event was removed', async () => {
    const error = await refusal(restore([committed(NONCE, COMMITMENT, SHORT_PAYLOAD, position(100, 0, true))]).result);

    expect(error.restoreCause).toStrictEqual(noBackupKept);
  });
});

describe('restoreConfiguration from a password: opening', () => {
  it('refuses backup-unopened with the size and the five values for a payload of the wrong length', async () => {
    const error = await refusal(restore([committed(NONCE, COMMITMENT, SHORT_PAYLOAD)]).result);

    expect(error.restoreCause).toStrictEqual(unopened(2));
    expect(error.cause).toBeUndefined();
  });

  it('never reads a clear serialization: it refuses backup-unopened', async () => {
    const clear = serializeConfiguration(CONFIGURATION);
    const error = await refusal(restore([committed(NONCE, COMMITMENT, clear)]).result);

    expect(error.restoreCause).toStrictEqual(unopened((clear.length - 2) / 2));
  });

  it.each([
    ['null', null],
    ['a string', 'password'],
  ])('refuses a source that is %s with a TypeError, never a refusal', async (_, source) => {
    const { double, result } = restore([committed(NONCE, COMMITMENT, SHORT_PAYLOAD)], source as unknown as ConfigurationSource);

    await expect(result).rejects.toThrow(TypeError);
    expect(double.fetches).toEqual([]);
  });

  it('refuses a malformed password with a TypeError, never a refusal', async () => {
    const source = { password: 5 } as unknown as ConfigurationSource;
    const { result } = restore([committed(NONCE, COMMITMENT, SHORT_PAYLOAD)], source);

    await expect(result).rejects.toThrow(TypeError);
    await expect(result).rejects.not.toBeInstanceOf(KitRefusalError);
  });
});

describe('restoreConfiguration from a configuration', () => {
  it('fetches no event and returns the configuration as given, labels kept', async () => {
    const labelled: Configuration = {
      ...CONFIGURATION,
      clauses: CONFIGURATION.clauses.map((clause) => ({
        ...clause,
        credentials: clause.credentials.map((credential) => ({ ...credential, label: 'mum' })),
      })),
    };
    const { double, result } = restore([committed(NONCE, COMMITMENT, SHORT_PAYLOAD)], labelled);

    await expect(result).resolves.toEqual(labelled);
    expect(double.fetches).toEqual([]);
  });

  it('refuses commitment-mismatch with the recomputed and the committed commitment', async () => {
    const other = `0x${'ab'.repeat(32)}` as Hex;
    const error = await refusal(restore([], CONFIGURATION, actionState(other, NONCE)).result);

    expect(error.restoreCause).toStrictEqual({
      code: 'restore.commitment-mismatch',
      subject: 'restore',
      values: { recomputed: COMMITMENT, committed: other },
    });
  });

  it('recomputes under the stored nonce', async () => {
    const error = await refusal(restore([], CONFIGURATION, actionState(COMMITMENT, NONCE + 1n)).result);

    expect(error.restoreCause?.code).toBe('restore.commitment-mismatch');
  });

  it('accepts an upper-case stored commitment and reports a mismatch lower-cased', async () => {
    const upper = `0x${COMMITMENT.slice(2).toUpperCase()}` as Hex;

    await expect(restore([], CONFIGURATION, actionState(upper, NONCE)).result).resolves.toEqual(CONFIGURATION);

    const other = `0x${'AB'.repeat(32)}` as Hex;
    const error = await refusal(restore([], CONFIGURATION, actionState(other, NONCE)).result);

    expect(error.restoreCause).toMatchObject({ values: { committed: other.toLowerCase() } });
  });
});

describe('restoreConfiguration refusals and argument errors', () => {
  it('gives the three causes three distinct non-empty messages', async () => {
    const noBackup = await refusal(restore([]).result);
    const unopenedError = await refusal(restore([committed(NONCE, COMMITMENT, SHORT_PAYLOAD)]).result);
    const mismatch = await refusal(restore([], CONFIGURATION, actionState(`0x${'ab'.repeat(32)}`, NONCE)).result);
    const messages = [noBackup.message, unopenedError.message, mismatch.message];

    expect(messages.every((message) => message.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(3);
  });

  it('carries the account and action checksummed whatever spelling was passed', async () => {
    const double = eventsDouble([]);
    const lower = ACCOUNT_MIXED.toLowerCase() as Hex;
    const error = await refusal(restoreConfiguration(double.events, lower, ACTION, PASSWORD, actionState(ZERO_WORD, 0n), BLOCK));

    expect(error.restoreCause).toMatchObject({ values: { account: getAddress(lower) } });
  });

  const malformed: readonly (readonly [string, Partial<{ account: Hex; action: Hex; state: unknown; block: unknown }>, typeof TypeError | typeof RangeError])[] = [
    ['an account with a failing checksum', { account: ACCOUNT_BAD_CHECKSUM }, TypeError],
    ['an action that is not an address', { action: '0x1234' }, TypeError],
    ['a block with a negative number', { block: { number: -1, hash: BLOCK.hash } }, RangeError],
    ['a block with a short hash', { block: { number: 1, hash: '0x12' } }, TypeError],
    ['a missing block', { block: undefined }, TypeError],
    ['a state commitment that is not 32 bytes', { state: { ...STATE, setupCommitment: '0x1234' } }, TypeError],
    ['a state nonce that is a number', { state: { ...STATE, setupNonce: 7 } }, TypeError],
    ['a state block that is negative', { state: { ...STATE, setupCommittedAtBlock: -1 } }, RangeError],
    ['a state block that is fractional', { state: { ...STATE, setupCommittedAtBlock: 1.5 } }, TypeError],
  ];

  it.each(malformed)('refuses %s before any read, never with a refusal', async (_, overrides, kind) => {
    const double = eventsDouble([committed(NONCE, COMMITMENT, SHORT_PAYLOAD)]);
    const result = restoreConfiguration(
      double.events,
      overrides.account ?? ACCOUNT,
      overrides.action ?? ACTION,
      PASSWORD,
      ('state' in overrides ? overrides.state : STATE) as ActionState,
      ('block' in overrides ? overrides.block : BLOCK) as PinnedBlock,
    );
    const thrown = await result.then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(kind);
    expect(thrown).not.toBeInstanceOf(KitRefusalError);
    expect(double.fetches).toEqual([]);
  });
});
