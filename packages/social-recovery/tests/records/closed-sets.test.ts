import type ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADD_REFUSAL_CAUSES,
  BACKUP_CHOICES,
  CANCELLED_BY,
  DEVICE_BINDINGS,
  KIT_ERROR_SOURCES,
  NOTIFICATION_KINDS,
  PURPOSES,
  REPLY_FAILURE_CAUSES,
  REQUEST_ERROR_CODES,
  REQUEST_WARNING_CODES,
  RESTORE_CAUSE_CODES,
  SENDERS,
  SETUP_ERROR_CODES,
  SETUP_WARNING_CODES,
  STANDINGS,
  VERDICTS,
} from '../../src/index';
import {
  constituentOfKind,
  constituents,
  exportedType,
  kindsOf,
  loadRecords,
  propertyNames,
  propertyType,
  type RecordContext,
  stringLiterals,
} from '../helpers/records';

const sorted = (values: readonly string[]): string[] => [...values].sort();

let context: RecordContext;

beforeAll(() => {
  context = loadRecords();
});

/** The string literals a property of an exported record type admits, sorted. */
function literalsOf(recordName: string, ...path: string[]): string[] | undefined {
  let type: ts.Type = exportedType(context, recordName);

  for (const name of path) type = propertyType(context.checker, type, name);

  return stringLiterals(type);
}

/** One notification kind per manager and method event, listed independently of src/. */
const NOTIFICATIONS = [
  { event: 'SetupCommitted', kind: 'setup-committed' },
  { event: 'SetupCleared', kind: 'setup-cleared' },
  { event: 'AttemptStarted', kind: 'attempt-started' },
  { event: 'AttemptCancelled', kind: 'attempt-cancelled' },
  { event: 'AttemptConsumed', kind: 'attempt-consumed' },
  { event: 'Paused', kind: 'method-paused' },
  { event: 'Unpaused', kind: 'method-unpaused' },
  { event: 'TrustedKeysUpdated', kind: 'method-keys-updated' },
  { event: 'AdminRenounced', kind: 'method-admin-renounced' },
  { event: 'AdminTransferOffered', kind: 'method-admin-transfer-offered' },
  { event: 'AdminTransferred', kind: 'method-admin-transferred' },
  { event: 'OwnershipTransferStarted', kind: 'method-pause-holder-transfer-started' },
  { event: 'OwnershipTransferred', kind: 'method-pause-holder-transferred' },
  { event: 'LogPrivilegeChanged', kind: 'privilege-changed' },
] as const;

/** The fields per kind, besides `kind` and `at`. */
const NOTIFICATION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'setup-committed': ['account', 'action', 'nonce', 'setupCommitment', 'publicMetadata', 'privateMetadata'],
  'setup-cleared': ['account', 'action', 'nonce'],
  'attempt-started': [
    'account', 'action', 'attemptId', 'setupNonce', 'setupBody', 'usedPlaces', 'usedMethods', 'payload', 'order',
    'consumableAfter',
  ],
  'attempt-cancelled': [
    'account', 'action', 'attemptId', 'canceller', 'vetoingMethod', 'cancelledBy', 'setupNonce', 'usedPlaces',
  ],
  'attempt-consumed': ['account', 'action', 'attemptId'],
  'method-paused': ['method', 'by'],
  'method-unpaused': ['method', 'by'],
  'method-keys-updated': ['method', 'previous', 'current'],
  'method-admin-renounced': ['method', 'previous'],
  'method-admin-transfer-offered': ['method', 'current', 'pending'],
  'method-admin-transferred': ['method', 'previous', 'current'],
  'method-pause-holder-transfer-started': ['method', 'previous', 'pending'],
  'method-pause-holder-transferred': ['method', 'previous', 'current'],
  'privilege-changed': ['account', 'addr', 'priv'],
};

const LOG_POSITION_FIELDS = ['blockNumber', 'blockHash', 'logIndex', 'transactionHash', 'removed'];

/** Only the meanings are specified; the spellings are the implementation's, so the test compares count and set. */
const REPLY_FAILURE = [
  { meaning: 'the device refused', spelling: 'device-refused' },
  { meaning: 'the device was unavailable', spelling: 'device-unavailable' },
  { meaning: 'the material was rejected as the wrong shape for this method', spelling: 'material-rejected' },
  { meaning: 'no implementation serves the method the request names', spelling: 'method-unsupported' },
  { meaning: "the request's kind or version is one this build does not read", spelling: 'request-unsupported' },
] as const;

const DEVICE_BINDING = ['none', 'browser-authenticator', 'external-app', 'in-browser-prover'];

/** Only the meanings are specified; the spellings are the implementation's, so the test compares count and set. */
const ADD_REFUSAL = [
  { meaning: 'a kind or version it does not read', spelling: 'kind-or-version-unread' },
  { meaning: 'six binding fields that do not match', spelling: 'binding-mismatch' },
  { meaning: "a digest that is not the one this gathering's own members produce for that place", spelling: 'digest-mismatch' },
  { meaning: 'a place the map does not name', spelling: 'place-unknown' },
  { meaning: "a method, config or salt that is not exactly the place's", spelling: 'credential-mismatch' },
] as const;

const RESTORE_CAUSES = ['restore.no-backup', 'restore.backup-unopened', 'restore.commitment-mismatch'];

const SETUP_ERRORS = [
  'rule.empty',
  'clause.empty',
  'rule.all-thresholds-zero',
  'clause.threshold-above-count',
  'clause.threshold-too-wide',
  'rule.too-wide',
  'credential.duplicate',
  'wait.field-width',
  'wait.above-maximum',
  'action.unsupported',
  'backup.too-wide',
];

const SETUP_WARNINGS = [
  'clause.single-point',
  'clause.threshold-zero',
  'clause.shared-failure',
  'clause.secondary-only',
  'method.unshipped',
  'method.no-declaration',
  'method.stopped',
  'action.unaudited',
  'action.fit-unchecked',
  'manager.already-armed',
  'setup.wait-short',
  'setup.wait-zero',
  'backup.clear',
  'backup.empty',
  'rule.repeated-person',
];

const REQUEST_ERRORS = [
  'request.attempt-id',
  'request.expired',
  'request.attempt-active',
  'request.no-active-attempt',
  'request.stale-attempt',
  'request.body-mismatch',
  'request.rule-unsatisfied',
  'request.method-stopped',
  'proof.places-unordered',
  'handover.removed-not-authority',
  'handover.new-holds-privilege',
  'handover.same-authority',
  'handover.malformed',
  'handover.removed-unknown',
];

const REQUEST_WARNINGS = [
  'payment.insufficient',
  'method.unshipped', // also a setup warning, so the ValidationWarning union holds it once
  'payment.open-payee',
  'payment.token-unknown',
  'request.window-wide',
  'request.window-short',
  'request.moment-skew',
  'cancel.window-late',
  'payment.sponsor-sees',
];

describe('the fourteen notification shapes', () => {
  it('derives fourteen distinct kinds from fourteen distinct events', () => {
    expect(new Set(NOTIFICATIONS.map((entry) => entry.kind)).size).toBe(14);
    expect(new Set(NOTIFICATIONS.map((entry) => entry.event)).size).toBe(14);
  });

  it('NOTIFICATION_KINDS is exactly the fourteen kinds', () => {
    expect(NOTIFICATION_KINDS).toHaveLength(14);
    expect(sorted(NOTIFICATION_KINDS)).toEqual(sorted(NOTIFICATIONS.map((entry) => entry.kind)));
  });

  it('KitNotification is a union of fourteen shapes discriminated by exactly those kinds', () => {
    const type = exportedType(context, 'KitNotification');

    expect(type.isUnion() ? type.types.length : 1).toBe(14);
    expect(kindsOf(context.checker, type)).toEqual(sorted(NOTIFICATIONS.map((entry) => entry.kind)));
  });

  it('NotificationKind is the same union as the tuple', () => {
    expect(literalsOf('NotificationKind')).toEqual(sorted(NOTIFICATION_KINDS));
  });

  it.each(NOTIFICATIONS.map((entry) => [entry.kind, entry.event]))(
    'the %s shape (event %s) carries the expected fields, kind and at',
    (kind) => {
      const shape = constituentOfKind(context.checker, exportedType(context, 'KitNotification'), kind);

      expect(propertyNames(context.checker, shape)).toEqual(sorted([...(NOTIFICATION_FIELDS[kind] ?? []), 'kind', 'at']));
      expect(propertyNames(context.checker, propertyType(context.checker, shape, 'at'))).toEqual(
        sorted(LOG_POSITION_FIELDS),
      );
    },
  );

  it("the attempt-cancelled shape's cancelledBy is the four cancellation causes", () => {
    const expected = sorted(['cancelByOwner', 'cancelByProofs', 'cancelByVeto', 'setupWrite']);
    const shape = constituentOfKind(context.checker, exportedType(context, 'KitNotification'), 'attempt-cancelled');

    expect(stringLiterals(propertyType(context.checker, shape, 'cancelledBy'))).toEqual(expected);
    expect(sorted(CANCELLED_BY)).toEqual(expected);
  });
});

describe('the five ReplyFailure causes', () => {
  it('derives five distinct meanings', () => {
    expect(new Set(REPLY_FAILURE.map((entry) => entry.meaning)).size).toBe(5);
  });

  it('REPLY_FAILURE_CAUSES holds five causes, one per meaning', () => {
    expect(REPLY_FAILURE_CAUSES).toHaveLength(5);
    expect(sorted(REPLY_FAILURE_CAUSES)).toEqual(sorted(REPLY_FAILURE.map((entry) => entry.spelling)));
  });

  it("ReplyFailure's cause admits exactly the tuple", () => {
    expect(literalsOf('ReplyFailure', 'cause')).toEqual(sorted(REPLY_FAILURE_CAUSES));
  });

  it('EnrollFailure is of the same shape, one failure type serving both sides', () => {
    const enroll = exportedType(context, 'EnrollFailure');
    const reply = exportedType(context, 'ReplyFailure');

    expect(context.checker.isTypeAssignableTo(enroll, reply)).toBe(true);
    expect(context.checker.isTypeAssignableTo(reply, enroll)).toBe(true);
  });
});

describe('the four DeviceBinding values', () => {
  it('DEVICE_BINDINGS is exactly the four, with the expected spellings', () => {
    expect(sorted(DEVICE_BINDINGS)).toEqual(sorted(DEVICE_BINDING));
  });

  it('DeviceBinding admits exactly the four', () => {
    expect(literalsOf('DeviceBinding')).toEqual(sorted(DEVICE_BINDING));
  });
});

describe('the five AddResult refusals', () => {
  it('derives five distinct meanings', () => {
    expect(new Set(ADD_REFUSAL.map((entry) => entry.meaning)).size).toBe(5);
  });

  it('ADD_REFUSAL_CAUSES holds five causes, one per meaning', () => {
    expect(ADD_REFUSAL_CAUSES).toHaveLength(5);
    expect(sorted(ADD_REFUSAL_CAUSES)).toEqual(sorted(ADD_REFUSAL.map((entry) => entry.spelling)));
  });

  /** The reason type of AddResult's refused member. */
  const refusedReason = (): ts.Type => {
    const refused = constituents(exportedType(context, 'AddResult')).filter(
      (member) => stringLiterals(propertyType(context.checker, member, 'outcome'))?.join() === 'refused',
    );

    expect(refused).toHaveLength(1);

    return propertyType(context.checker, refused[0] as ts.Type, 'reason');
  };

  it("the refused AddResult's reason names exactly those five", () => {
    expect(stringLiterals(propertyType(context.checker, refusedReason(), 'cause'))).toEqual(sorted(ADD_REFUSAL_CAUSES));
    expect(literalsOf('AddRefusal', 'cause')).toEqual(sorted(ADD_REFUSAL_CAUSES));
  });

  it('the refused member carries the AddRefusal type as its reason', () => {
    const reason = refusedReason();
    const refusal = exportedType(context, 'AddRefusal');

    expect(context.checker.isTypeAssignableTo(reason, refusal)).toBe(true);
    expect(context.checker.isTypeAssignableTo(refusal, reason)).toBe(true);
  });

  it('the reason is of the same shape as the reply failure: the same field names', () => {
    expect(propertyNames(context.checker, refusedReason())).toEqual(
      propertyNames(context.checker, exportedType(context, 'ReplyFailure')),
    );
  });
});

describe('the three restore causes', () => {
  it('RESTORE_CAUSE_CODES is exactly the three', () => {
    expect(sorted(RESTORE_CAUSE_CODES)).toEqual(sorted(RESTORE_CAUSES));
  });

  it("RestoreCause's code admits exactly the three", () => {
    expect(literalsOf('RestoreCause', 'code')).toEqual(sorted(RESTORE_CAUSES));
  });
});

describe('the finding codes', () => {
  it.each([
    ['setup errors', SETUP_ERROR_CODES, SETUP_ERRORS, 11],
    ['setup warnings', SETUP_WARNING_CODES, SETUP_WARNINGS, 15],
    ['request errors', REQUEST_ERROR_CODES, REQUEST_ERRORS, 14],
    ['request warnings', REQUEST_WARNING_CODES, REQUEST_WARNINGS, 9],
  ] as const)('the %s tuple is the table, in its order', (_label, tuple, table, count) => {
    expect(table).toHaveLength(count);
    expect([...tuple]).toEqual(table);
  });

  it("ValidationError's code is the setup and request errors together, twenty-five codes", () => {
    const expected = sorted([...new Set([...SETUP_ERRORS, ...REQUEST_ERRORS])]);

    expect(expected).toHaveLength(25);
    expect(literalsOf('ValidationError', 'code')).toEqual(expected);
  });

  it("ValidationWarning's code is the setup and request warnings together, method.unshipped once", () => {
    const expected = sorted([...new Set([...SETUP_WARNINGS, ...REQUEST_WARNINGS])]);

    expect(expected).toHaveLength(23);
    expect(literalsOf('ValidationWarning', 'code')).toEqual(expected);
  });

  it('no code is both an error and a warning, and no restore code is either', () => {
    const errors = new Set([...SETUP_ERRORS, ...REQUEST_ERRORS]);
    const warnings = new Set([...SETUP_WARNINGS, ...REQUEST_WARNINGS]);

    expect([...errors].filter((code) => warnings.has(code))).toEqual([]);
    expect(RESTORE_CAUSES.filter((code) => errors.has(code) || warnings.has(code))).toEqual([]);
  });
});

describe('the smaller closed sets', () => {
  it.each([
    ['Sender', 'Sender', SENDERS, ['account', 'anyone']],
    ['Purpose', 'Purpose', PURPOSES, ['approval', 'cancellation']],
    ['Standing', 'Standing', STANDINGS, ['not-stopped', 'stopped']],
    ['KitErrorSource', 'KitErrorSource', KIT_ERROR_SOURCES, ['manager', 'action', 'account', 'language']],
    ['BackupChoice', 'BackupChoice', BACKUP_CHOICES, ['encrypted', 'clear', 'empty']],
  ] as const)('%s', (_label, typeName, tuple, expected) => {
    expect(sorted(tuple)).toEqual(sorted(expected));
    expect(literalsOf(typeName)).toEqual(sorted(expected));
  });

  it('Verdict has three answers: satisfied, rejected, not judged', () => {
    expect(VERDICTS).toHaveLength(3);
    expect(VERDICTS).toContain('satisfied');
    expect(VERDICTS).toContain('rejected');
    expect(literalsOf('Verdict')).toEqual(sorted(VERDICTS));
  });
});
