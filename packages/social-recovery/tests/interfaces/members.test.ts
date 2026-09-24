import { beforeAll, describe, expect, it } from 'vitest';
import { createSourceProgram, findInterfaces, type InterfaceShape, type MemberKind, shapeOf } from '../helpers/source';

// Each list below was derived from design/offchain/sdk.md before src/ was read.
// The comment on a member gives the line it was taken from: the defining
// section (D-202 539-693, D-203 694-838, D-204 839-977, D-206 1205-1478,
// D-207 1479-1593, D-208 1594-1660) and, where the name appears only there,
// D-201's prose (99-127) or its illustrative drawings (148-292). A member drawn
// without parentheses in D-201's drawings is a value ('property'); every other
// member is a call ('method').
const EXPECTED: Readonly<Record<string, Readonly<Record<string, MemberKind>>>> = {
  // Freeze list 525 "with the members listed above": D-201 101, drawing 150-160.
  ISetupClient: {
    validateSetup: 'method', // D-201 101; D-202 640
    describeSetup: 'method', // D-201 101; drawing 153
    prepareCommitSetup: 'method', // D-202 594
    prepareClearSetup: 'method', // D-202 596
    confirmSetup: 'method', // D-202 597
    setupState: 'method', // D-202 640
    getSetup: 'method', // D-202 650
    events: 'property', // drawing 159, usage 499; D-203 702
  },
  // Freeze list 525: D-201 106, drawing 161-176.
  IRecoveryClient: {
    initRecoveryGathering: 'method', // D-202 650; D-207 1535
    initCancelGathering: 'method', // D-202 650; D-207 1536
    getApproverRequests: 'method', // D-201 106; D-207 1537
    addApproverReply: 'method', // D-201 106; D-207 1538
    assess: 'method', // D-201 106; D-207 1539
    complete: 'method', // D-201 106; D-207 1540
    prepareStartAttempt: 'method', // D-202 613
    prepareCancelByProofs: 'method', // D-202 622
    prepareCancelByOwner: 'method', // D-202 619
    prepareCancelByVeto: 'method', // D-202 623
    prepareExecuteHandover: 'method', // D-202 632
    recoveryState: 'method', // D-202 642
    events: 'property', // drawing 175; D-203 702
  },
  // Freeze list 526 "the six calls D-206 states": D-201 110, drawing 248-256.
  IMethodsOrchestrator: {
    describeRequest: 'method', // D-206 1243
    verify: 'method', // D-206 1229
    signingInput: 'method', // D-206 1237
    replyFrom: 'method', // D-206 1237, 1239
    enrollInput: 'method', // D-206 1241, 1310
    configFrom: 'method', // D-206 1239, 1315
  },
  // Freeze list 527 "whose members D-202 ... define": D-201 111-112, D-202 670-673.
  // The drawing (177-187) shows eight of these sixteen; the prose wins.
  IPolicyManagerInteractor: {
    stateOf: 'method', // D-202 670
    name: 'method', // D-202 670
    version: 'method', // D-202 670
    supportsInterface: 'method', // D-202 670
    hashApproval: 'method', // D-202 671
    hashCancel: 'method', // D-202 671
    eip712Domain: 'method', // D-202 671
    moduleInfo: 'method', // D-202 673
    paused: 'method', // D-202 673
    trustedParties: 'method', // D-202 673
    // "the six prepares the manager's own functions name" (D-201 111), over
    // the manager functions of D-202 564 and 623.
    prepareCommitSetup: 'method', // D-202 564 commitSetup
    prepareClearSetup: 'method', // D-202 564 clearSetup
    prepareCancelByOwner: 'method', // D-202 564 cancelByOwner
    prepareStartAttempt: 'method', // D-201 111; D-202 564 startAttempt
    prepareCancelByProofs: 'method', // D-202 564 cancelByProofs
    prepareCancelByVeto: 'method', // D-202 623 cancelByVeto
  },
  // Freeze list 527: D-201 113, drawing 188-193.
  IMethodModuleReads: {
    moduleInfo: 'method', // D-202 673
    paused: 'method', // D-202 673
    trustedParties: 'method', // D-202 673
  },
  // Freeze list 537: D-201 114, drawing 194-202.
  IRecoveryActionInteractor: {
    supportsAccount: 'method', // D-202 589
    isAuthority: 'method', // D-202 589, 607
    isAuthorized: 'method', // D-202 589
    holdsAnyPrivilege: 'method', // D-202 607
    actionInfo: 'method', // D-202 672
    disarmingCall: 'method', // D-202 596
  },
  // Freeze list 537 "the arming seam's one member": D-201 105.
  IRecoveryActionArming: {
    armingCall: 'method', // D-201 105, 537; drawing 205
  },
  // Freeze list 527: D-203 698, 794 (decoding, filtering, fetching); drawing 207-214.
  IEventManager: {
    accountFilter: 'method', // D-203 739
    methodFilter: 'method', // D-203 740
    privilegeFilter: 'method', // D-203 741
    fetch: 'method', // D-203 745, 761
    decodeLog: 'method', // D-203 794 (unnamed there); drawing 213, usage 501
  },
  // Freeze list 528: D-201 120, D-204 902-904, drawing 277-282.
  IActionCodec: {
    actions: 'property', // D-204 902
    encode: 'method', // D-201 120; D-204 904
    decode: 'method', // D-201 120; D-204 904
  },
  // Freeze list 528: D-204 917.
  IMethodCodec: {
    encodeConfig: 'method', // D-204 917
    decodeConfig: 'method', // D-204 917
    encodeProof: 'method', // D-204 917
    decodeProof: 'method', // D-204 917
  },
  // Freeze list 528 "the ten members": D-201 119, D-206 1217, drawing 257-269.
  IRecoveryMethod: {
    modules: 'method', // D-206 1219
    enrollInput: 'method', // D-206 1220
    configFrom: 'method', // D-206 1220
    signingInput: 'method', // D-206 1221
    replyFrom: 'method', // D-206 1222
    verify: 'method', // D-206 1223
    codec: 'property', // D-206 1224
    deviceBinding: 'property', // D-206 1225
    describe: 'method', // D-206 1226
    vector: 'property', // D-206 1227
  },
  // Freeze list 528 "the four reads D-208 fixes": D-208 1638-1643, drawing 215-221.
  IProvider: {
    chainId: 'method', // D-208 1640; named in drawing 217
    call: 'method', // D-208 1641; named in drawing 218
    logs: 'method', // D-208 1642; named in drawing 219
    block: 'method', // D-208 1643
  },
};

let shapes: Map<string, InterfaceShape>;

beforeAll(() => {
  const program = createSourceProgram();
  const checker = program.getTypeChecker();

  shapes = new Map(
    findInterfaces(program)
      .filter((site) => site.file.startsWith('src/interfaces/'))
      .map((site): [string, InterfaceShape] => [site.name, shapeOf(checker, site.node)]),
  );
});

const shape = (name: string): InterfaceShape => {
  const found = shapes.get(name);

  if (found === undefined) throw new Error(`${name} is not declared under src/interfaces/`);

  return found;
};

it('carries a member list for each of the twelve interfaces', () => {
  expect(Object.keys(EXPECTED)).toHaveLength(12);
});

describe.each(Object.entries(EXPECTED))('%s', (name, expected) => {
  it('declares exactly the members the chapter draws', () => {
    expect([...shape(name).members.keys()].sort()).toEqual(Object.keys(expected).sort());
  });

  it('declares each drawn member as the chapter draws it, a call or a value', () => {
    const actual = shape(name).members;
    const drawn = Object.keys(expected).filter((member) => actual.has(member));

    expect(Object.fromEntries(drawn.map((member) => [member, actual.get(member)]))).toEqual(
      Object.fromEntries(drawn.map((member) => [member, expected[member]])),
    );
  });

  it('declares no call, construct or index signature', () => {
    const { callSignatures, constructSignatures, indexSignatures } = shape(name);

    expect({ callSignatures, constructSignatures, indexSignatures }).toEqual({
      callSignatures: 0,
      constructSignatures: 0,
      indexSignatures: 0,
    });
  });
});
