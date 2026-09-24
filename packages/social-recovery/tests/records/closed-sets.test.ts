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

// Every list below was derived from design/offchain/sdk.md before src/ was
// read; the comment on each entry is the line it comes from. Where the chapter
// fixes a spelling, the test compares spellings. Where it gives a meaning and
// no spelling, the entry records the meaning with the spelling the
// implementation chose beside it: the test then compares the count and the
// set, and the meaning-to-spelling pairing is the tester's judgment, reported
// under "Spelling notes" rather than taken from the chapter.

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

// (a) D-203, the event table (lines 708-723) and the sketch's kinds (lines
// 773-791). The sketch is illustrative, and line 765 says "the exact types
// freeze with this section", so the kind spellings are the sketch's.
const NOTIFICATIONS = [
  { event: 'SetupCommitted', kind: 'setup-committed', line: 774 }, // table 710
  { event: 'SetupCleared', kind: 'setup-cleared', line: 776 }, // table 711
  { event: 'AttemptStarted', kind: 'attempt-started', line: 777 }, // table 712
  { event: 'AttemptCancelled', kind: 'attempt-cancelled', line: 780 }, // table 713
  { event: 'AttemptConsumed', kind: 'attempt-consumed', line: 782 }, // table 714
  { event: 'Paused', kind: 'method-paused', line: 783 }, // table 715
  { event: 'Unpaused', kind: 'method-unpaused', line: 784 }, // table 716
  { event: 'TrustedKeysUpdated', kind: 'method-keys-updated', line: 785 }, // table 717
  { event: 'AdminRenounced', kind: 'method-admin-renounced', line: 786 }, // table 718
  { event: 'AdminTransferOffered', kind: 'method-admin-transfer-offered', line: 787 }, // table 719
  { event: 'AdminTransferred', kind: 'method-admin-transferred', line: 788 }, // table 720
  { event: 'OwnershipTransferStarted', kind: 'method-pause-holder-transfer-started', line: 789 }, // table 721
  { event: 'OwnershipTransferred', kind: 'method-pause-holder-transferred', line: 790 }, // table 722
  { event: 'LogPrivilegeChanged', kind: 'privilege-changed', line: 791 }, // table 723
] as const;

// The sketch's fields per kind (lines 774-791), `kind` and `at` included.
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

const LOG_POSITION_FIELDS = ['blockNumber', 'blockHash', 'logIndex', 'transactionHash', 'removed']; // 769

// (b) D-206 line 1239: "a typed failure naming one of five causes". The
// chapter names meanings, not spellings.
const REPLY_FAILURE = [
  { meaning: 'the device refused', spelling: 'device-refused' },
  { meaning: 'the device was unavailable', spelling: 'device-unavailable' },
  { meaning: 'the material was rejected as the wrong shape for this method', spelling: 'material-rejected' },
  { meaning: 'no implementation serves the method the request names', spelling: 'method-unsupported' },
  { meaning: "the request's kind or version is one this build does not read", spelling: 'request-unsupported' },
] as const;

// (c) D-206 line 1225: "one of four values and no other", spelled there.
const DEVICE_BINDING = ['none', 'browser-authenticator', 'external-app', 'in-browser-prover'];

// (d) D-207 line 1538 and owner ruling cut-q-22: exactly five refusals, no
// sixth. Meanings from the chapter, spellings the implementation's.
const ADD_REFUSAL = [
  { meaning: 'a kind or version it does not read', spelling: 'kind-or-version-unread' },
  { meaning: 'six binding fields that do not match', spelling: 'binding-mismatch' },
  { meaning: "a digest that is not the one this gathering's own members produce for that place", spelling: 'digest-mismatch' },
  { meaning: 'a place the map does not name', spelling: 'place-unknown' },
  { meaning: "a method, config or salt that is not exactly the place's", spelling: 'credential-mismatch' },
] as const;

// (e) D-205 lines 1090-1092, spelled there.
const RESTORE_CAUSES = ['restore.no-backup', 'restore.backup-unopened', 'restore.commitment-mismatch'];

// (g) D-205's four finding tables, spelled there.
const SETUP_ERRORS = [
  'rule.empty', // 1011
  'clause.empty', // 1012
  'rule.all-thresholds-zero', // 1013
  'clause.threshold-above-count', // 1014
  'clause.threshold-too-wide', // 1015
  'rule.too-wide', // 1016
  'credential.duplicate', // 1017
  'wait.field-width', // 1018
  'wait.above-maximum', // 1019
  'action.unsupported', // 1020
  'backup.too-wide', // 1021
];

const SETUP_WARNINGS = [
  'clause.single-point', // 1027
  'clause.threshold-zero', // 1028
  'clause.shared-failure', // 1029
  'clause.secondary-only', // 1030
  'method.unshipped', // 1031
  'method.no-declaration', // 1032
  'method.stopped', // 1033
  'action.unaudited', // 1034
  'action.fit-unchecked', // 1035
  'manager.already-armed', // 1036
  'setup.wait-short', // 1037
  'setup.wait-zero', // 1038
  'backup.clear', // 1039
  'backup.empty', // 1040
  'rule.repeated-person', // 1041
];

const REQUEST_ERRORS = [
  'request.attempt-id', // 1049
  'request.expired', // 1050
  'request.attempt-active', // 1051
  'request.no-active-attempt', // 1052
  'request.stale-attempt', // 1053
  'request.body-mismatch', // 1054
  'request.rule-unsatisfied', // 1055
  'request.method-stopped', // 1056
  'proof.places-unordered', // 1057
  'handover.removed-not-authority', // 1058
  'handover.new-holds-privilege', // 1059
  'handover.same-authority', // 1060
  'handover.malformed', // 1061
  'handover.removed-unknown', // 1062
];

const REQUEST_WARNINGS = [
  'payment.insufficient', // 1070
  'method.unshipped', // 1071, the setup code at the second moment
  'payment.open-payee', // 1072
  'payment.token-unknown', // 1073
  'request.window-wide', // 1074
  'request.window-short', // 1075
  'request.moment-skew', // 1076
  'cancel.window-late', // 1077
  'payment.sponsor-sees', // 1078
];

describe('(a) the fourteen notification shapes of D-203', () => {
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

  it.each(NOTIFICATIONS.map((entry) => [entry.kind, entry.event, entry.line]))(
    'the %s shape (event %s, sketch line %s) carries the sketch fields, kind and at',
    (kind) => {
      const shape = constituentOfKind(context.checker, exportedType(context, 'KitNotification'), kind);

      expect(propertyNames(context.checker, shape)).toEqual(sorted([...(NOTIFICATION_FIELDS[kind] ?? []), 'kind', 'at']));
      expect(propertyNames(context.checker, propertyType(context.checker, shape, 'at'))).toEqual(
        sorted(LOG_POSITION_FIELDS),
      );
    },
  );

  it("the attempt-cancelled shape's cancelledBy is the four causes of line 771", () => {
    const expected = sorted(['cancelByOwner', 'cancelByProofs', 'cancelByVeto', 'setupWrite']);
    const shape = constituentOfKind(context.checker, exportedType(context, 'KitNotification'), 'attempt-cancelled');

    expect(stringLiterals(propertyType(context.checker, shape, 'cancelledBy'))).toEqual(expected);
    expect(sorted(CANCELLED_BY)).toEqual(expected);
  });
});

describe('(b) the five ReplyFailure causes of D-206 line 1239', () => {
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

  it('EnrollFailure is of the same shape, one failure type serving both sides (lines 1220, 1239)', () => {
    const enroll = exportedType(context, 'EnrollFailure');
    const reply = exportedType(context, 'ReplyFailure');

    expect(context.checker.isTypeAssignableTo(enroll, reply)).toBe(true);
    expect(context.checker.isTypeAssignableTo(reply, enroll)).toBe(true);
  });
});

describe('(c) the four DeviceBinding values of D-206 line 1225', () => {
  it('DEVICE_BINDINGS is exactly the four, spelled as the chapter spells them', () => {
    expect(sorted(DEVICE_BINDINGS)).toEqual(sorted(DEVICE_BINDING));
  });

  it('DeviceBinding admits exactly the four', () => {
    expect(literalsOf('DeviceBinding')).toEqual(sorted(DEVICE_BINDING));
  });
});

describe('(d) the five AddResult refusals of D-207 line 1538, no sixth (cut-q-22)', () => {
  it('derives five distinct meanings', () => {
    expect(new Set(ADD_REFUSAL.map((entry) => entry.meaning)).size).toBe(5);
  });

  it('ADD_REFUSAL_CAUSES holds five causes, one per meaning', () => {
    expect(ADD_REFUSAL_CAUSES).toHaveLength(5);
    expect(sorted(ADD_REFUSAL_CAUSES)).toEqual(sorted(ADD_REFUSAL.map((entry) => entry.spelling)));
  });

  /** The member of AddResult whose outcome is `refused` (D-207 l.1538: on a refusal it carries a reason). */
  const refusedReason = (): ts.Type => {
    const refused = constituents(exportedType(context, 'AddResult')).filter(
      (member) => stringLiterals(propertyType(context.checker, member, 'outcome'))?.join() === 'refused',
    );

    expect(refused).toHaveLength(1);

    return propertyType(context.checker, refused[0] as ts.Type, 'reason');
  };

  it("the refused AddResult's reason names exactly those five and no sixth", () => {
    expect(stringLiterals(propertyType(context.checker, refusedReason(), 'cause'))).toEqual(sorted(ADD_REFUSAL_CAUSES));
    expect(literalsOf('AddRefusal', 'cause')).toEqual(sorted(ADD_REFUSAL_CAUSES));
  });

  it('the refused member carries the AddRefusal type as its reason', () => {
    const reason = refusedReason();
    const refusal = exportedType(context, 'AddRefusal');

    expect(context.checker.isTypeAssignableTo(reason, refusal)).toBe(true);
    expect(context.checker.isTypeAssignableTo(refusal, reason)).toBe(true);
  });

  it('the reason is of the same shape as the reply failure of D-206: the same field names', () => {
    expect(propertyNames(context.checker, refusedReason())).toEqual(
      propertyNames(context.checker, exportedType(context, 'ReplyFailure')),
    );
  });
});

describe('(e) the three restore causes of D-205 lines 1090-1092', () => {
  it('RESTORE_CAUSE_CODES is exactly the three', () => {
    expect(sorted(RESTORE_CAUSE_CODES)).toEqual(sorted(RESTORE_CAUSES));
  });

  it("RestoreCause's code admits exactly the three", () => {
    expect(literalsOf('RestoreCause', 'code')).toEqual(sorted(RESTORE_CAUSES));
  });
});

describe('(g) the finding codes of D-205', () => {
  it.each([
    ['setup errors, lines 1009-1021', SETUP_ERROR_CODES, SETUP_ERRORS, 11],
    ['setup warnings, lines 1025-1041', SETUP_WARNING_CODES, SETUP_WARNINGS, 15],
    ['request errors, lines 1047-1062', REQUEST_ERROR_CODES, REQUEST_ERRORS, 14],
    ['request warnings, lines 1068-1078', REQUEST_WARNING_CODES, REQUEST_WARNINGS, 9],
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

describe('the smaller closed sets the chapter spells', () => {
  it.each([
    ['Sender, D-202 line 557', 'Sender', SENDERS, ['account', 'anyone']],
    ['Purpose, D-205 line 1129 and D-207 lines 1494, 1503', 'Purpose', PURPOSES, ['approval', 'cancellation']],
    ['Standing, D-207 lines 1525, 1529', 'Standing', STANDINGS, ['not-stopped', 'stopped']],
    ['KitErrorSource, D-205 line 1191', 'KitErrorSource', KIT_ERROR_SOURCES, ['manager', 'action', 'account', 'language']],
    ['BackupChoice, D-202 line 593', 'BackupChoice', BACKUP_CHOICES, ['encrypted', 'clear', 'empty']],
  ] as const)('%s', (_label, typeName, tuple, expected) => {
    expect(sorted(tuple)).toEqual(sorted(expected));
    expect(literalsOf(typeName)).toEqual(sorted(expected));
  });

  it('Verdict has three answers, D-206 line 1223: satisfied, rejected, not judged', () => {
    expect(VERDICTS).toHaveLength(3);
    expect(VERDICTS).toContain('satisfied');
    expect(VERDICTS).toContain('rejected');
    expect(literalsOf('Verdict')).toEqual(sorted(VERDICTS));
  });
});
