import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import type { Address, BlockTag, Hex, IProvider } from '../../src/index';
import { createSourceProgram, findInterfaces, type InterfaceShape, type MemberKind, shapeOf } from '../helpers/source';

/** Each interface's members, listed independently of src/: a member without parentheses is a 'property', any other a 'method'. */
const EXPECTED: Readonly<Record<string, Readonly<Record<string, MemberKind>>>> = {
  ISetupClient: {
    validateSetup: 'method',
    describeSetup: 'method',
    prepareCommitSetup: 'method',
    prepareClearSetup: 'method',
    confirmSetup: 'method',
    setupState: 'method',
    getSetup: 'method',
    events: 'property',
  },
  IRecoveryClient: {
    initRecoveryGathering: 'method',
    initCancelGathering: 'method',
    getApproverRequests: 'method',
    addApproverReply: 'method',
    assess: 'method',
    complete: 'method',
    prepareStartAttempt: 'method',
    prepareCancelByProofs: 'method',
    prepareCancelByOwner: 'method',
    prepareCancelByVeto: 'method',
    prepareExecuteHandover: 'method',
    recoveryState: 'method',
    events: 'property',
  },
  IMethodsOrchestrator: {
    describeRequest: 'method',
    verify: 'method',
    signingInput: 'method',
    replyFrom: 'method',
    enrollInput: 'method',
    configFrom: 'method',
  },
  IPolicyManagerInteractor: {
    stateOf: 'method',
    name: 'method',
    version: 'method',
    supportsInterface: 'method',
    hashApproval: 'method',
    hashCancel: 'method',
    eip712Domain: 'method',
    moduleInfo: 'method',
    paused: 'method',
    trustedParties: 'method',
    prepareCommitSetup: 'method',
    prepareClearSetup: 'method',
    prepareCancelByOwner: 'method',
    prepareStartAttempt: 'method',
    prepareCancelByProofs: 'method',
    prepareCancelByVeto: 'method',
  },
  IMethodModuleReads: {
    moduleInfo: 'method',
    paused: 'method',
    trustedParties: 'method',
  },
  IRecoveryActionInteractor: {
    supportsAccount: 'method',
    isAuthority: 'method',
    isAuthorized: 'method',
    holdsAnyPrivilege: 'method',
    actionInfo: 'method',
    disarmingCall: 'method',
  },
  IRecoveryActionArming: {
    armingCall: 'method',
  },
  IEventManager: {
    accountFilter: 'method',
    methodFilter: 'method',
    privilegeFilter: 'method',
    fetch: 'method',
    decodeLog: 'method',
  },
  IActionCodec: {
    actions: 'property',
    encode: 'method',
    decode: 'method',
  },
  IMethodCodec: {
    encodeConfig: 'method',
    decodeConfig: 'method',
    encodeProof: 'method',
    decodeProof: 'method',
  },
  IRecoveryMethod: {
    modules: 'method',
    enrollInput: 'method',
    configFrom: 'method',
    signingInput: 'method',
    replyFrom: 'method',
    verify: 'method',
    codec: 'property',
    deviceBinding: 'property',
    describe: 'method',
    vector: 'property',
  },
  IProvider: {
    chainId: 'method',
    call: 'method',
    logs: 'method',
    block: 'method',
    code: 'method',
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
  it('declares exactly the expected members', () => {
    expect([...shape(name).members.keys()].sort()).toEqual(Object.keys(expected).sort());
  });

  it('declares each expected member with the expected kind, a call or a value', () => {
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

describe('IProvider.code', () => {
  it('takes (Address, BlockTag) and returns Promise<Hex>', () => {
    expectTypeOf<IProvider['code']>().parameters.toEqualTypeOf<[address: Address, block: BlockTag]>();
    expectTypeOf<IProvider['code']>().returns.toEqualTypeOf<Promise<Hex>>();
    expectTypeOf<IProvider>().toHaveProperty('code');
  });
});
