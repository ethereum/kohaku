import { describe, expect, it } from 'vitest';
import type { Address, Hex, KitNotification } from '../../src/index';
import { readVector } from '../kat/read-vector';
import {
  encodeEvent,
  lower,
  makeReader,
  MANAGER,
  MANAGER_EVENT_NAMES,
  METHOD_AADHAAR,
  METHOD_EVENT_NAMES,
  rawLog,
  TOPIC0,
  type EventName,
} from './fixture';

type Row = {
  readonly 'id': string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly expected: { readonly topics: readonly Hex[]; readonly data: Hex };
};

type Loaded = { readonly rows: readonly Row[]; readonly source: string };

/** One vector file's rows, read from its copy under `tests/kat/vectors/`. */
const load = (file: string): Loaded => ({
  rows: readVector(file).vectors as readonly Row[],
  source: `tests/kat/vectors/${file}`,
});

const MANAGER_ROWS = load('manager-events.json');
const METHOD_ROWS = load('method-events.json');

/** The integer fields, which the vector files spell as decimal strings. */
const INTEGER_FIELDS = new Set(['nonce', 'attemptId', 'setupNonce', 'amount']);

const typed = (key: string, value: unknown): unknown => {
  if (key === 'usedPlaces' && Array.isArray(value)) return value.map((entry) => BigInt(String(entry)));

  if (key === 'order' && value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([inner, entry]) => [inner, typed(inner, entry)]));
  }

  if (INTEGER_FIELDS.has(key)) return BigInt(String(value));

  return value;
};

const typedInput = (input: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typed(key, value)]));

/** The notification's fields a row's input names, the method rows' `account` being the notification's `by`. */
const fieldsOf = (notification: KitNotification, input: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const values = notification as unknown as Record<string, unknown>;

  return Object.fromEntries(Object.keys(input).map((key) => [key, key === 'account' && 'by' in values ? values['by'] : values[key]]));
};

const replay = (
  label: string,
  loaded: Loaded,
  names: readonly EventName[],
  emitter: Address,
  extra: (name: string, notification: KitNotification) => void,
): void => {
  describe(`${label} (${loaded.source})`, () => {
    const { rows } = loaded;
    const reader = makeReader();

    it('has one row per event name the file covers, each an event of the derived ABI', () => {
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) expect(names).toContain(row['id']);
    });

    it.each(rows.map((row) => [row['id'], row] as const))('%s: the independent ABI re-encodes the row to its bytes', (name, row) => {
      const encoded = encodeEvent(name as EventName, typedInput(row.input));

      expect(row.expected.topics[0]).toBe(TOPIC0[name as EventName]);
      expect(lower(encoded)).toEqual(lower({ topics: row.expected.topics, data: row.expected.data }));
    });

    it.each(rows.map((row) => [row['id'], row] as const))('%s: decodeLog gives back the row\'s input', (name, row) => {
      const notification = reader.decodeLog(rawLog(emitter, row.expected.topics, row.expected.data));

      expect(notification, `${name} decoded to nothing`).toBeDefined();

      const decoded = notification as KitNotification;

      expect(lower(fieldsOf(decoded, row.input))).toEqual(lower(typedInput(row.input)));
      extra(name, decoded);
    });
  });
};

replay('manager-events.json', MANAGER_ROWS, MANAGER_EVENT_NAMES, MANAGER, (name, notification) => {
  const expectedKind: Record<string, string> = {
    SetupCommitted: 'setup-committed',
    SetupCleared: 'setup-cleared',
    AttemptStarted: 'attempt-started',
    AttemptCancelled: 'attempt-cancelled',
    AttemptConsumed: 'attempt-consumed',
  };

  expect(notification.kind).toBe(expectedKind[name]);

  // The row's vetoingMethod is nonzero, which settles cancelledBy alone.
  if (notification.kind === 'attempt-cancelled') expect(notification.cancelledBy).toBe('cancelByVeto');

  if (notification.kind === 'attempt-started') expect(typeof notification.consumableAfter).toBe('number');
});

replay('method-events.json', METHOD_ROWS, METHOD_EVENT_NAMES, METHOD_AADHAAR, (name, notification) => {
  const expectedKind: Record<string, string> = {
    Paused: 'method-paused',
    Unpaused: 'method-unpaused',
    TrustedKeysUpdated: 'method-keys-updated',
    AdminRenounced: 'method-admin-renounced',
    AdminTransferOffered: 'method-admin-transfer-offered',
    AdminTransferred: 'method-admin-transferred',
  };

  expect(notification.kind).toBe(expectedKind[name]);
  expect('method' in notification ? notification.method.toLowerCase() : undefined).toBe(METHOD_AADHAAR.toLowerCase());
});
