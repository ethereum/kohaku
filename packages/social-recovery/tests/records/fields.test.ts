import ts from 'typescript';
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import {
  ADD_OUTCOMES,
  type ApproverRequest,
  type Configuration,
  type Ctx,
  type ConfigurationSource,
  type GatheringPlace,
  NO_BACKUP_CASES,
  RESTORE_CAUSE_CODES,
} from '../../src/index';
import {
  constituents,
  exportedType,
  hasFlag,
  isOptional,
  kindsOf,
  loadRecords,
  propertyNames,
  propertyType,
  type RecordContext,
  stringLiterals,
  visitType,
} from '../helpers/records';
import { compileProbes, PROBE_IMPORT_FROM } from '../helpers/probe';

// Field lists derived from design/offchain/sdk.md before src/ was read; each
// carries the line it comes from. "usage" lines are D-201's illustrative
// usage (406-519), which fixes a name only where no section's prose does.

const sorted = (values: readonly string[]): string[] => [...values].sort();

let context: RecordContext;

beforeAll(() => {
  context = loadRecords();
});

const typeOf = (name: string): ts.Type => exportedType(context, name);
const fieldsOf = (type: ts.Type): string[] => propertyNames(context.checker, type);
const field = (type: ts.Type, name: string): ts.Type => propertyType(context.checker, type, name);
const optional = (type: ts.Type, name: string): boolean => isOptional(context.checker, type, name);
const isString = (type: ts.Type): boolean => hasFlag(type, ts.TypeFlags.String);
const isNumber = (type: ts.Type): boolean => hasFlag(type, ts.TypeFlags.Number);
const mutuallyAssignable = (a: ts.Type, b: ts.Type): boolean =>
  context.checker.isTypeAssignableTo(a, b) && context.checker.isTypeAssignableTo(b, a);

/** The element type of an array-typed property. */
function elementOf(type: ts.Type, name: string): ts.Type {
  const array = field(type, name);
  const [element] = context.checker.isArrayType(array)
    ? context.checker.getTypeArguments(array as ts.TypeReference)
    : [];

  if (element === undefined) throw new Error(`${name} is not an array`);

  return element;
}

// D-205 lines 1104-1117: the setup description's rows. Thirteen plus removedKey (1111).
const SETUP_DESCRIPTION_FIELDS = [
  'rule', // 1104
  'wait', // 1105
  'failureDomains', // 1106
  'parties', // 1107
  'methodStanding', // 1108
  'passkeyDomains', // 1109
  'candidateKeys', // 1110
  'privacy', // 1112
  'backup', // 1113
  'reveals', // 1114
  'cancel', // 1115
  'upgrade', // 1116
  'pause', // 1117
];

describe('the setup description of D-205 and the recovery state of D-202', () => {
  it('derives thirteen fields besides removedKey', () => {
    expect(new Set(SETUP_DESCRIPTION_FIELDS).size).toBe(13);
  });

  it('SetupDescription carries exactly the thirteen fields and removedKey (lines 1104-1117)', () => {
    expect(fieldsOf(typeOf('SetupDescription'))).toEqual(sorted([...SETUP_DESCRIPTION_FIELDS, 'removedKey']));
  });

  it('removedKey is an address or a value saying no creation triple was given, and is required (lines 644, 1111)', () => {
    const removedKey = field(typeOf('SetupDescription'), 'removedKey');
    const members = constituents(removedKey);
    const addressLike = members.filter((member) => hasFlag(member, ts.TypeFlags.TemplateLiteral | ts.TypeFlags.String));
    const markers = members.filter((member) => member.isStringLiteral());

    expect(optional(typeOf('SetupDescription'), 'removedKey')).toBe(false);
    expect(addressLike.length).toBeGreaterThan(0);
    expect(markers.length).toBeGreaterThan(0);
    expect(context.checker.isTypeAssignableTo(typeOf('Address'), removedKey)).toBe(true);
    expect(markers.every((marker) => !context.checker.isTypeAssignableTo(marker, typeOf('Address')))).toBe(true);
  });

  it('RecoveryState carries removedKey, required and of the same type as the description (line 644)', () => {
    const recovery = typeOf('RecoveryState');

    expect(fieldsOf(recovery)).toContain('removedKey');
    expect(optional(recovery, 'removedKey')).toBe(false);
    expect(mutuallyAssignable(field(recovery, 'removedKey'), field(typeOf('SetupDescription'), 'removedKey'))).toBe(true);
  });

  it('RecoveryState is the attempt sub-record, the next id, the current commitment and nonce, removedKey and the block (lines 642-646)', () => {
    const recovery = typeOf('RecoveryState');

    expect(fieldsOf(recovery)).toEqual(
      sorted(['attempt', 'nextAttemptId', 'setupCommitment', 'setupNonce', 'removedKey', 'block']),
    );
    expect(fieldsOf(field(recovery, 'attempt'))).toEqual(
      sorted(['state', 'attemptId', 'setupNonce', 'consumableAfter', 'payloadHash', 'order', 'usedMethods', 'ignoresPause']),
    );
    expect(fieldsOf(field(recovery, 'block'))).toEqual(sorted(['number', 'timestamp', 'hash']));
  });

  it('SetupState is the chain facts of line 640 and the block of line 646, no removedKey', () => {
    const setupState = typeOf('SetupState');

    expect(fieldsOf(setupState)).toEqual(
      sorted(['isAuthorized', 'hasSetup', 'setupCommitment', 'setupNonce', 'setupCommittedAtBlock', 'attemptActive', 'block']),
    );
    expect(fieldsOf(field(setupState, 'block'))).toEqual(sorted(['number', 'timestamp', 'hash']));
  });
});

describe('the prepared call and the prepared batch of D-202', () => {
  it('PreparedCall carries the table of lines 551-560, kind the literal call', () => {
    const call = typeOf('PreparedCall');

    expect(fieldsOf(call)).toEqual(
      sorted(['kind', 'target', 'value', 'data', 'sender', 'block', 'simulation', 'describes']),
    );
    expect(stringLiterals(field(call, 'kind'))).toEqual(['call']);
    expect(stringLiterals(field(call, 'sender'))).toEqual(['account', 'anyone']);
    expect(fieldsOf(field(call, 'block'))).toEqual(sorted(['number', 'hash']));
  });

  it('simulation and describes may be absent, every other field is required (lines 559-560)', () => {
    const call = typeOf('PreparedCall');
    const absent = fieldsOf(call).filter((name) => optional(call, name));

    expect(absent).toEqual(['describes', 'simulation']);
  });

  it('PreparedBatch is kind batch, a list of prepared calls, an atomic flag and the pinned block (line 562)', () => {
    const batch = typeOf('PreparedBatch');

    expect(fieldsOf(batch)).toEqual(sorted(['kind', 'calls', 'atomic', 'block']));
    expect(stringLiterals(field(batch, 'kind'))).toEqual(['batch']);
    expect(mutuallyAssignable(elementOf(batch, 'calls'), typeOf('PreparedCall'))).toBe(true);
    expect(hasFlag(field(batch, 'atomic'), ts.TypeFlags.BooleanLike)).toBe(true);
    expect(mutuallyAssignable(field(batch, 'block'), field(typeOf('PreparedCall'), 'block'))).toBe(true);
  });

  it('prepareCommitSetup and prepareClearSetup answer the union, told apart by kind alone (lines 594-596)', () => {
    const client = context.entry.get('ISetupClient');

    expect(client).toBeDefined();

    const clientType = context.checker.getDeclaredTypeOfSymbol(client as ts.Symbol);

    for (const member of ['prepareCommitSetup', 'prepareClearSetup']) {
      const [signature] = context.checker.getSignaturesOfType(field(clientType, member), ts.SignatureKind.Call);
      const resolved = context.checker.getAwaitedType(
        context.checker.getReturnTypeOfSignature(signature as ts.Signature),
      );

      expect(resolved).toBeDefined();
      expect(kindsOf(context.checker, resolved as ts.Type), member).toEqual(['batch', 'call']);
    }
  });
});

// D-207 lines 1494-1500, 1503, 1508-1514, 1519-1529. 'credentialHoldsCode' is
// added by the owner ruling of 2026-09-24 (a recorded delta extending D-207
// 1494-1500 and D-206 1260), on both the approval and cancellation branches.
const REQUEST_FIELDS = [
  'kind', 'version', 'purpose', 'chainId', 'manager', 'digestVersion', 'account', 'action', 'attemptId', 'setupNonce',
  'setupBodyHash', 'payload', 'order', 'validUntil', 'place', 'method', 'config', 'salt',
  'credentialHoldsCode', // owner ruling 2026-09-24, extending D-207 1494-1500
];
const REPLY_FIELDS = [
  'kind', 'version', 'chainId', 'manager', 'account', 'action', 'attemptId', 'purpose', 'place', 'method', 'config',
  'salt', 'digest', 'proof',
];
const GATHERING_REQUEST_FIELDS = [
  'chainId', 'manager', 'digestVersion', 'account', 'action', 'attemptId', 'setupNonce', 'setupBody', 'payload',
  'order', 'validUntil', 'block',
];
// Line 1514: the six fields that bind a reply to one gathering by inspection.
const BINDING_FIELDS = ['chainId', 'manager', 'account', 'action', 'attemptId', 'purpose'];
const without = (list: readonly string[], ...drop: string[]): string[] => list.filter((name) => !drop.includes(name));

describe('the three gathering records of D-207', () => {
  it.each([
    ['ApproverRequest', 'recovery-proof-request'], // 1494
    ['Reply', 'recovery-proof-reply'], // 1508
    ['Gathering', 'gathering'], // 1519
  ])('%s carries a version field and the kind %s on every shape (line 1489)', (name, kind) => {
    for (const shape of constituents(typeOf(name))) {
      expect(fieldsOf(shape)).toContain('version');
      expect(optional(shape, 'version')).toBe(false);
      expect(isNumber(field(shape, 'version')) || isString(field(shape, 'version'))).toBe(true);
      expect(stringLiterals(field(shape, 'kind'))).toEqual([kind]);
    }
  });

  it('ApproverRequest, renamed from Request, is the approval record of lines 1494-1500', () => {
    const approval = constituents(typeOf('ApproverRequest')).filter(
      (shape) => stringLiterals(field(shape, 'purpose'))?.[0] === 'approval',
    );

    expect(approval).toHaveLength(1);
    expect(fieldsOf(approval[0] as ts.Type)).toEqual(sorted(REQUEST_FIELDS));
  });

  it('a cancellation ApproverRequest is the same record with no payload and no order (line 1503)', () => {
    const cancellation = constituents(typeOf('ApproverRequest')).filter(
      (shape) => stringLiterals(field(shape, 'purpose'))?.[0] === 'cancellation',
    );

    expect(cancellation).toHaveLength(1);
    expect(fieldsOf(cancellation[0] as ts.Type)).toEqual(sorted(without(REQUEST_FIELDS, 'payload', 'order')));
  });

  // Owner ruling 2026-09-24, extending D-207 1494-1500 and 1503: every request
  // says whether its credential's config address holds code, as a required boolean.
  it.each(['approval', 'cancellation'])(
    'a %s ApproverRequest carries credentialHoldsCode as a required boolean (owner ruling 2026-09-24)',
    (purpose) => {
      const branch = constituents(typeOf('ApproverRequest')).filter(
        (shape) => stringLiterals(field(shape, 'purpose'))?.[0] === purpose,
      );

      expect(branch).toHaveLength(1);
      const shape = branch[0] as ts.Type;

      expect(optional(shape, 'credentialHoldsCode')).toBe(false);
      expect(context.checker.typeToString(field(shape, 'credentialHoldsCode'))).toBe('boolean');
    },
  );

  it('credentialHoldsCode is a required boolean on both branches, type-level (owner ruling 2026-09-24)', () => {
    type Approval = Extract<ApproverRequest, { purpose: 'approval' }>;
    type Cancellation = Extract<ApproverRequest, { purpose: 'cancellation' }>;

    expectTypeOf<Approval['credentialHoldsCode']>().toEqualTypeOf<boolean>();
    expectTypeOf<Cancellation['credentialHoldsCode']>().toEqualTypeOf<boolean>();
    expectTypeOf<Pick<Approval, 'credentialHoldsCode'>>().toEqualTypeOf<{ readonly credentialHoldsCode: boolean }>();
    expectTypeOf<Pick<Cancellation, 'credentialHoldsCode'>>().toEqualTypeOf<{ readonly credentialHoldsCode: boolean }>();
  });

  it('ApproverRequest carries the six binding fields of line 1514 and the digest version its digest derives under (line 1495)', () => {
    for (const shape of constituents(typeOf('ApproverRequest'))) {
      expect(fieldsOf(shape)).toEqual(expect.arrayContaining([...BINDING_FIELDS, 'digestVersion']));
    }
  });

  it('Reply carries the six binding fields, the digest and the proof, and no window and no payload (lines 1508-1514)', () => {
    const reply = typeOf('Reply');

    expect(fieldsOf(reply)).toEqual(sorted(REPLY_FIELDS));
    expect(fieldsOf(reply)).toEqual(expect.arrayContaining([...BINDING_FIELDS, 'digest']));
  });

  it('Gathering holds the request block, the place map and the replies, no satisfied, filled or verified field (lines 1516-1529)', () => {
    for (const shape of constituents(typeOf('Gathering'))) {
      expect(fieldsOf(shape)).toEqual(sorted(['kind', 'version', 'purpose', 'request', 'places', 'replies']));
      expect(fieldsOf(elementOf(shape, 'places'))).toEqual(
        // 'credentialHoldsCode': owner ruling 2026-09-24 completing the
        // credentialHoldsCode ruling, a delta to D-207 1524; the init stores it
        // so a reopened gathering holds it (1529) and getApproverRequests copies
        // it without a read (1533).
        sorted(['place', 'method', 'config', 'salt', 'label', 'standing', 'stoppable', 'credentialHoldsCode']),
      );
      expect(mutuallyAssignable(elementOf(shape, 'replies'), typeOf('Reply'))).toBe(true);
      expect(fieldsOf(field(field(shape, 'request'), 'block'))).toEqual(sorted(['number', 'timestamp', 'hash']));
    }
  });

  // Owner ruling 2026-09-24 completing the credentialHoldsCode ruling: the
  // place stores the flag (D-207 1529) and the request copies it (1533).
  it('the gathering place and the request hold credentialHoldsCode as the same required boolean, type-level (owner ruling 2026-09-24)', () => {
    expectTypeOf<GatheringPlace['credentialHoldsCode']>().toEqualTypeOf<boolean>();
    expectTypeOf<ApproverRequest['credentialHoldsCode']>().toEqualTypeOf<boolean>();
    expectTypeOf<GatheringPlace['credentialHoldsCode']>().toEqualTypeOf<ApproverRequest['credentialHoldsCode']>();
    expectTypeOf<Pick<GatheringPlace, 'credentialHoldsCode'>>().toEqualTypeOf<{ readonly credentialHoldsCode: boolean }>();

    for (const shape of constituents(typeOf('Gathering'))) {
      const place = elementOf(shape, 'places');

      expect(optional(place, 'credentialHoldsCode')).toBe(false);
      expect(context.checker.typeToString(field(place, 'credentialHoldsCode'))).toBe('boolean');
    }
  });

  // Pure record construction, no client: place, then the request cut from it
  // by copying the flag (D-207 1533, no read), then the ctx around it (D-206 1229).
  it.each([true, false])(
    'credentialHoldsCode %s travels from the gathering place to the request to the ctx (owner ruling 2026-09-24)',
    (holdsCode) => {
      const place: GatheringPlace = {
        place: 0,
        method: '0x00000000000000000000000000000000000000e1',
        config: '0x00000000000000000000000000000000000000a1',
        salt: '0x',
        standing: 'not-stopped',
        stoppable: false,
        credentialHoldsCode: holdsCode,
      };
      const request: ApproverRequest = {
        kind: 'recovery-proof-request',
        version: 1,
        chainId: '1',
        manager: '0x0000000000000000000000000000000000000001',
        digestVersion: '1',
        account: '0x0000000000000000000000000000000000000002',
        action: '0x0000000000000000000000000000000000000003',
        attemptId: '1',
        setupNonce: '1',
        setupBodyHash: '0x00',
        validUntil: '1790000000',
        place: place.place,
        method: place.method,
        config: place.config,
        salt: place.salt,
        credentialHoldsCode: place.credentialHoldsCode,
        purpose: 'cancellation',
      };
      const ctx: Ctx = {
        request,
        place: request.place,
        digest: '0x00',
        typedData: {
          domain: { name: 'PolicyManager', version: '1', chainId: 1, verifyingContract: request.manager },
          types: {},
          primaryType: 'Cancellation',
          message: {
            account: request.account,
            action: request.action,
            attemptId: 1n,
            setupNonce: 1n,
            setupBodyHash: request.setupBodyHash,
            validUntil: 1790000000,
            place: request.place,
          },
        },
      };
      // The place survives a closed tab as JSON (D-207 1529).
      const reopened = JSON.parse(JSON.stringify(place)) as GatheringPlace;

      expect(place.credentialHoldsCode).toBe(holdsCode);
      expect(reopened.credentialHoldsCode).toBe(holdsCode);
      expect(request.credentialHoldsCode).toBe(holdsCode);
      expect(ctx.request.credentialHoldsCode).toBe(holdsCode);
    },
  );

  it("an approval gathering's request block is the members of lines 1520-1523", () => {
    const [approval] = constituents(typeOf('Gathering')).filter(
      (shape) => stringLiterals(field(shape, 'purpose'))?.[0] === 'approval',
    );

    expect(approval).toBeDefined();
    expect(fieldsOf(field(approval as ts.Type, 'request'))).toEqual(sorted(GATHERING_REQUEST_FIELDS));
  });

  it("a cancellation gathering's request block drops payload and order and holds consumableAfter (lines 1503, 1529)", () => {
    const [cancellation] = constituents(typeOf('Gathering')).filter(
      (shape) => stringLiterals(field(shape, 'purpose'))?.[0] === 'cancellation',
    );

    expect(cancellation).toBeDefined();
    expect(fieldsOf(field(cancellation as ts.Type, 'request'))).toEqual(
      sorted([...without(GATHERING_REQUEST_FIELDS, 'payload', 'order'), 'consumableAfter']),
    );
  });
});

describe('the big values inside the gathering records travel as decimal strings (D-207 line 1489)', () => {
  const bigintPaths = (name: string): string[] => {
    const bigints: string[] = [];

    visitType(
      context.checker,
      typeOf(name),
      (type, path) => {
        if (hasFlag(type, ts.TypeFlags.BigIntLike)) bigints.push(path);
      },
      name,
    );

    return bigints;
  };

  it('the bigint walk finds the bigints of an on-chain record, AttemptRequest, as a control', () => {
    expect(bigintPaths('AttemptRequest').length).toBeGreaterThan(0);
  });

  it.each(['ApproverRequest', 'Reply', 'Gathering'])('%s reaches no bigint anywhere, so it survives a JSON parse', (name) => {
    expect(bigintPaths(name)).toEqual([]);
  });

  it('the attempt id, the setup nonce, the window, the chain id and the order amount are strings, the place a number', () => {
    for (const name of ['ApproverRequest', 'Reply']) {
      for (const shape of constituents(typeOf(name))) {
        for (const member of ['attemptId', 'chainId']) expect(isString(field(shape, member)), `${name}.${member}`).toBe(true);

        expect(isNumber(field(shape, 'place')), `${name}.place`).toBe(true);
      }
    }

    for (const shape of constituents(typeOf('ApproverRequest'))) {
      for (const member of ['setupNonce', 'validUntil']) expect(isString(field(shape, member)), member).toBe(true);
    }

    const approvalRequest = constituents(typeOf('ApproverRequest')).find(
      (shape) => stringLiterals(field(shape, 'purpose'))?.[0] === 'approval',
    );

    expect(isString(field(field(approvalRequest as ts.Type, 'order'), 'amount'))).toBe(true);
  });

  it("the gathering's request block carries its big values and the pinned timestamp as strings", () => {
    for (const shape of constituents(typeOf('Gathering'))) {
      const request = field(shape, 'request');

      for (const member of ['chainId', 'attemptId', 'setupNonce', 'validUntil']) {
        expect(isString(field(request, member)), member).toBe(true);
      }

      expect(isString(field(field(request, 'block'), 'timestamp'))).toBe(true);
      expect(isNumber(field(elementOf(shape, 'places'), 'place'))).toBe(true);
    }

    const [approval, cancellation] = ['approval', 'cancellation'].map((purpose) =>
      constituents(typeOf('Gathering')).find((shape) => stringLiterals(field(shape, 'purpose'))?.[0] === purpose),
    );

    expect(isString(field(field(field(approval as ts.Type, 'request'), 'order'), 'amount'))).toBe(true);
    expect(isString(field(field(cancellation as ts.Type, 'request'), 'consumableAfter'))).toBe(true);
  });
});

describe('the other records whose fields the chapter names', () => {
  it.each(['SetupState', 'RecoveryState', 'Configuration', 'SetupConfirmation', 'AddResult', 'Assessment', 'EnrollFailure'])(
    '%s, returned by a frozen member, carries no version field of its own (D-201 line 532)',
    (name) => {
      for (const shape of constituents(typeOf(name))) expect(fieldsOf(shape)).not.toContain('version');
    },
  );

  it.each([
    ['Handover', ['newAuthority', 'removedAuthority'], 'D-202 line 608'],
    ['SetupConfirmation', ['landed', 'nonce', 'setupCommitment', 'isAuthorized', 'position'], 'D-202 line 597'],
    ['Assessment', ['filled', 'missing', 'clauses', 'ruleSatisfied', 'findings'], 'D-207 line 1539, usage lines 492-493'],
    ['BlockRange', ['from', 'to'], 'D-203 line 745, usage line 500'],
    ['ValidationResult', ['errors', 'warnings'], 'D-205 line 994, usage line 445'],
    ['ValidityWindow', ['window'], 'usage line 470'],
    [
      'DeploymentDescriptor',
      [
        'chainId', 'manager', 'methodEcdsa', 'methodPasskey', 'methodAadhaar', 'methodZkpassport', 'action',
        'servedImplementation', 'deployedAt', 'digestVersion', 'managerVersion', 'shippedMethods', 'auditedActions',
      ],
      'D-208 lines 1606-1618',
    ],
  ] as const)('%s carries exactly the fields the chapter names', (name, expected, source) => {
    expect(fieldsOf(typeOf(name)), `${name}, ${source}`).toEqual(sorted(expected));
  });

  it('every descriptor field is required, a partial descriptor being a type error (D-208 line 1636)', () => {
    const descriptor = typeOf('DeploymentDescriptor');

    expect(fieldsOf(descriptor).filter((name) => optional(descriptor, name))).toEqual([]);
  });

  it('the handover leaves removedAuthority optional and newAuthority required (D-202 line 608, owner ruling)', () => {
    expect(optional(typeOf('Handover'), 'newAuthority')).toBe(false);
    expect(optional(typeOf('Handover'), 'removedAuthority')).toBe(true);
  });

  it('the client configuration carries the fields the usage names (usage lines 417-419)', () => {
    const configuration = typeOf('ClientConfiguration');

    expect(fieldsOf(configuration)).toEqual(expect.arrayContaining(['tokens', 'candidateKeys', 'creation', 'blockTags']));
    expect(fieldsOf(field(configuration, 'creation'))).toEqual(sorted(['factory', 'bytecode', 'salt', 'block']));
    expect(fieldsOf(field(configuration, 'blockTags'))).toEqual(sorted(['read', 'watch']));
  });

  // The configuration source (D-202 line 654) is judged by assignability in
  // "the configuration source of D-202 line 654" below.

  it("ReplyFailure is kind reply-failure with its cause (usage line 482)", () => {
    const failure = typeOf('ReplyFailure');

    expect(stringLiterals(field(failure, 'kind'))).toEqual(['reply-failure']);
    expect(fieldsOf(failure)).toContain('cause');
  });

  it('the ctx carries the place and its digest beside the request (D-206 line 1229)', () => {
    expect(fieldsOf(typeOf('Ctx'))).toEqual(expect.arrayContaining(['place', 'digest']));
  });

  // Owner ruling 2026-09-24, extending D-206 1229 and 1260: the flag reaches a
  // method's verify through ctx.request, with no field of its own on Ctx.
  it('ctx.request.credentialHoldsCode reaches verify as a boolean (owner ruling 2026-09-24)', () => {
    expectTypeOf<Ctx['request']['credentialHoldsCode']>().toEqualTypeOf<boolean>();
    expect(fieldsOf(field(typeOf('Ctx'), 'request'))).toContain('credentialHoldsCode');
  });

  it('the setup draft carries the wait, the clauses, the pause choice and the privacy dial (usage lines 434-442)', () => {
    const draft = typeOf('SetupDraft');

    expect(fieldsOf(draft)).toEqual(sorted(['wait', 'clauses', 'ignoresPause', 'privacy']));
    expect(fieldsOf(field(draft, 'privacy'))).toEqual(sorted(['publicMetadata', 'backup']));
    expect(fieldsOf(elementOf(elementOf(draft, 'clauses'), 'credentials'))).toEqual(
      sorted(['method', 'config', 'label', 'salt']),
    );
  });

  it('a configuration is not a draft: it carries no privacy dial (D-202 line 652)', () => {
    expect(fieldsOf(typeOf('Configuration'))).not.toContain('privacy');
    expect(context.checker.isTypeAssignableTo(typeOf('Configuration'), typeOf('SetupDraft'))).toBe(false);
  });
});

/** The one member of a union whose `discriminant` property is exactly the given literal. */
function memberWith(type: ts.Type, discriminant: string, value: string): ts.Type {
  const found = constituents(type).filter(
    (member) => stringLiterals(field(member, discriminant))?.join() === value,
  );

  expect(found, `${discriminant} ${value}`).toHaveLength(1);

  return found[0] as ts.Type;
}

const isAddressLike = (type: ts.Type): boolean => hasFlag(type, ts.TypeFlags.TemplateLiteral | ts.TypeFlags.String);
const isBigint = (type: ts.Type): boolean => hasFlag(type, ts.TypeFlags.BigInt);

// D-207 line 1538: the result names the reply it displaced, or nothing when the
// place was empty, and on a refusal carries a `reason` beside the record passed
// in, unchanged. Owner ruling (PT-071 fix 2): two members discriminated by
// `outcome`, `filed` and `refused`.
describe('the add result of D-207 line 1538, a union over outcome', () => {
  it('has exactly two members, one per outcome filed and refused, matching ADD_OUTCOMES', () => {
    const members = constituents(typeOf('AddResult'));

    expect(members).toHaveLength(2);
    expect(sorted(members.flatMap((member) => stringLiterals(field(member, 'outcome')) ?? ['<not a literal>']))).toEqual([
      'filed',
      'refused',
    ]);
    expect(sorted(ADD_OUTCOMES)).toEqual(['filed', 'refused']);
    expect(stringLiterals(typeOf('AddOutcome'))).toEqual(['filed', 'refused']);
  });

  it('the filed member carries exactly outcome, gathering and an optional displaced reply, and no reason', () => {
    const filed = memberWith(typeOf('AddResult'), 'outcome', 'filed');

    expect(fieldsOf(filed)).toEqual(sorted(['outcome', 'gathering', 'displaced']));
    expect(optional(filed, 'outcome')).toBe(false);
    expect(optional(filed, 'gathering')).toBe(false);
    expect(optional(filed, 'displaced')).toBe(true);
    expect(mutuallyAssignable(field(filed, 'displaced'), typeOf('Reply'))).toBe(true);
    expect(mutuallyAssignable(field(filed, 'gathering'), typeOf('Gathering'))).toBe(true);
    expect(mutuallyAssignable(filed, typeOf('AddFiled'))).toBe(true);
  });

  it('the refused member carries exactly outcome, gathering and a required reason, and no displaced', () => {
    const refused = memberWith(typeOf('AddResult'), 'outcome', 'refused');

    expect(fieldsOf(refused)).toEqual(sorted(['outcome', 'gathering', 'reason']));
    expect(optional(refused, 'outcome')).toBe(false);
    expect(optional(refused, 'gathering')).toBe(false);
    expect(optional(refused, 'reason')).toBe(false);
    expect(mutuallyAssignable(field(refused, 'reason'), typeOf('AddRefusal'))).toBe(true);
    expect(mutuallyAssignable(field(refused, 'gathering'), typeOf('Gathering'))).toBe(true);
    expect(mutuallyAssignable(refused, typeOf('AddRefused'))).toBe(true);
  });
});

// D-202 line 660 and D-205 lines 1086-1092: one record per restore code, the
// values its row names. The spellings of the two no-backup cases and of the
// setup nonce are the implementation's; the meanings are the chapter's.
const NO_BACKUP = [
  { meaning: 'no setup stands (l.660, l.1090)', spelling: 'no-setup' },
  { meaning: 'a standing setup kept no backup (l.660, l.1090)', spelling: 'no-backup-kept' },
] as const;

// D-202 line 654: the five the cipher authenticates under.
const AUTHENTICATED = [
  { meaning: 'the account', spelling: 'account' },
  { meaning: 'the action', spelling: 'action' },
  { meaning: 'the setup commitment', spelling: 'setupCommitment' },
  { meaning: 'the setup nonce', spelling: 'nonce' },
  { meaning: 'the payload version', spelling: 'payloadVersion' },
] as const;

describe('the restore cause of D-202 line 660 and D-205 lines 1086-1092, a union over code', () => {
  const cause = (code: string): ts.Type => memberWith(typeOf('RestoreCause'), 'code', code);
  const values = (code: string): ts.Type => field(cause(code), 'values');

  it('has exactly three members, one per code of RESTORE_CAUSE_CODES, each of subject restore', () => {
    const members = constituents(typeOf('RestoreCause'));

    expect(members).toHaveLength(3);
    expect(sorted(members.flatMap((member) => stringLiterals(field(member, 'code')) ?? ['<not a literal>']))).toEqual(
      sorted(RESTORE_CAUSE_CODES),
    );

    for (const member of members) expect(stringLiterals(field(member, 'subject'))).toEqual(['restore']);
  });

  it('derives two distinct no-backup meanings', () => {
    expect(new Set(NO_BACKUP.map((entry) => entry.meaning)).size).toBe(2);
  });

  it('no-backup carries the account, the action, which case fired and an optional nonce (l.1090)', () => {
    const noBackup = values('restore.no-backup');

    expect(fieldsOf(noBackup)).toEqual(sorted(['account', 'action', 'case', 'nonce']));
    expect(optional(noBackup, 'account')).toBe(false);
    expect(optional(noBackup, 'action')).toBe(false);
    expect(optional(noBackup, 'case')).toBe(false);
    expect(optional(noBackup, 'nonce')).toBe(true);
    expect(isAddressLike(field(noBackup, 'account'))).toBe(true);
    expect(isAddressLike(field(noBackup, 'action'))).toBe(true);
    expect(isBigint(field(noBackup, 'nonce'))).toBe(true);
  });

  it('the case is exactly the two literals of NO_BACKUP_CASES, one per meaning of line 660', () => {
    const expected = sorted(NO_BACKUP.map((entry) => entry.spelling));

    expect(stringLiterals(field(values('restore.no-backup'), 'case'))).toEqual(expected);
    expect(sorted(NO_BACKUP_CASES)).toEqual(expected);
    expect(NO_BACKUP_CASES).toHaveLength(2);
  });

  it('backup-unopened carries the payload size and the five authenticated values (l.654, l.1091)', () => {
    const unopened = values('restore.backup-unopened');

    expect(fieldsOf(unopened)).toContain('payloadSize');
    expect(isNumber(field(unopened, 'payloadSize'))).toBe(true);

    const others = fieldsOf(unopened).filter((name) => name !== 'payloadSize');

    expect(others, 'the five travel under one field beside payloadSize').toHaveLength(1);

    const five = field(unopened, others[0] as string);

    expect(new Set(AUTHENTICATED.map((entry) => entry.meaning)).size).toBe(5);
    expect(fieldsOf(five)).toEqual(sorted(AUTHENTICATED.map((entry) => entry.spelling)));
    expect(fieldsOf(five).filter((name) => optional(five, name))).toEqual([]);
    expect(isAddressLike(field(five, 'account'))).toBe(true);
    expect(isAddressLike(field(five, 'action'))).toBe(true);
    expect(isAddressLike(field(five, 'setupCommitment'))).toBe(true);
    expect(isBigint(field(five, 'nonce'))).toBe(true);
    expect(isNumber(field(five, 'payloadVersion'))).toBe(true);
  });

  it('commitment-mismatch carries the recomputed commitment and the committed one (l.1092)', () => {
    const mismatch = values('restore.commitment-mismatch');

    expect(fieldsOf(mismatch)).toEqual(sorted(['recomputed', 'committed']));
    expect(fieldsOf(mismatch).filter((name) => optional(mismatch, name))).toEqual([]);
    expect(isAddressLike(field(mismatch, 'recomputed'))).toBe(true);
    expect(isAddressLike(field(mismatch, 'committed'))).toBe(true);
  });
});

// D-202 line 654: "The source is `{ password }` or the configuration itself",
// the configuration "cached by a wallet or read off a clear backup". So a
// cached Configuration is passed as it is, with no wrapper around it, and the
// two forms are told apart by the password alone.
describe('the configuration source of D-202 line 654', () => {
  const MINIMAL_CONFIGURATION: Configuration = {
    clauses: [{ threshold: 1, credentials: [{ method: '0x00000000000000000000000000000000000000a1', config: '0x01' }] }],
    wait: 86_400,
    ignoresPause: false,
  };

  const header = `import type { Configuration, ConfigurationSource } from '${PROBE_IMPORT_FROM}';
const configuration: Configuration = {
  clauses: [{ threshold: 1, credentials: [{ method: '0x00000000000000000000000000000000000000a1', config: '0x01' }] }],
  wait: 86400,
  ignoresPause: false,
};
`;

  let probes: Map<string, string[]>;

  beforeAll(() => {
    probes = compileProbes({
      'source-password': `${header}export const source: ConfigurationSource = { password: 'correct horse' };\nvoid configuration;\n`,
      'source-configuration-literal': `${header}export const source: ConfigurationSource = configuration;\n`,
      'source-configuration-inline': `import type { ConfigurationSource } from '${PROBE_IMPORT_FROM}';
export const source: ConfigurationSource = { clauses: [], wait: 0, ignoresPause: true };
`,
      'source-wrapper-literal': `${header}export const source: ConfigurationSource = { configuration };\n`,
      'source-wrapper-value': `${header}const wrapped = { configuration };\nexport const source: ConfigurationSource = wrapped;\n`,
      'narrow-password': `${header}export function read(source: ConfigurationSource): string | Configuration {
  if ('password' in source) {
    const only: { readonly password: string } = source;

    return only.password;
  }

  const cached: Configuration = source;

  return cached;
}
void configuration;
`,
      'narrow-password-excludes-configuration': `${header}export function read(source: ConfigurationSource): number {
  if ('password' in source) return source.wait;

  return 0;
}
void configuration;
`,
    });
  });

  const errorsOf = (name: string): string[] => {
    const errors = probes.get(name);

    if (errors === undefined) throw new Error(`no probe ${name}`);

    return errors;
  };

  it('a { password } literal is a source', () => {
    expectTypeOf<{ password: string }>().toExtend<ConfigurationSource>();
    expect(errorsOf('source-password')).toEqual([]);
  });

  it('a Configuration value is a source as it is, with no wrapper', () => {
    expectTypeOf(MINIMAL_CONFIGURATION).toExtend<ConfigurationSource>();
    expect(errorsOf('source-configuration-literal')).toEqual([]);
    expect(errorsOf('source-configuration-inline')).toEqual([]);
  });

  it('a { configuration } wrapper is not a source, as a literal or as a value', () => {
    expectTypeOf<{ configuration: Configuration }>().not.toExtend<ConfigurationSource>();
    // @ts-expect-error the wrapper is the shape line 654 does not name
    const rejected: ConfigurationSource = { configuration: MINIMAL_CONFIGURATION };

    expect(rejected).toBeDefined();
    expect(errorsOf('source-wrapper-literal').join('\n')).toMatch(/TS2353: .*'configuration' does not exist/);
    expect(errorsOf('source-wrapper-value').join('\n')).toMatch(/TS2322: /);
  });

  it("'password' in source narrows to the password branch, and its negation to the configuration", () => {
    const describeSource = (source: ConfigurationSource): string =>
      'password' in source ? `password ${source.password.length}` : `configuration ${source.clauses.length}`;

    expect(describeSource({ password: 'pw' })).toBe('password 2');
    expect(describeSource(MINIMAL_CONFIGURATION)).toBe('configuration 1');
    expect(errorsOf('narrow-password')).toEqual([]);
    expect(errorsOf('narrow-password-excludes-configuration').join('\n')).toMatch(/TS2339: Property 'wait' does not exist/);
  });

  it.each(['Configuration', 'Clause', 'Credential'])(
    '%s has no index signature and no password field, so nothing on the configuration side swallows password',
    (name) => {
      const type = typeOf(name);

      expect(context.checker.getIndexInfosOfType(type)).toHaveLength(0);
      expect(fieldsOf(type)).not.toContain('password');
    },
  );

  it('the source has exactly two members: the password one and Configuration itself', () => {
    const members = constituents(typeOf('ConfigurationSource'));

    expect(members).toHaveLength(2);
    expect(members.filter((member) => mutuallyAssignable(member, typeOf('Configuration')))).toHaveLength(1);
    expect(members.filter((member) => fieldsOf(member).join() === 'password')).toHaveLength(1);
  });
});
