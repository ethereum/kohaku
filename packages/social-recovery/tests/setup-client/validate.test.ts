import { describe, expect, it } from 'vitest';
import {
  BUILDER_SEPOLIA_DESCRIPTOR,
  passkeyMethod,
  SetupClient,
  validateSetup,
  walletMethod,
  type Hex,
  type ActionInfo,
  type Address,
  type KitNotification,
  type MethodRegistry,
  type IRecoveryMethod,
  type ReadResult,
  type SetupDraft,
  type SetupValidationContext,
} from '../../src/index';
import {
  ACCEPT_EVERY_CONFIG,
  ACCOUNT,
  ACTION,
  ACTION_INFO,
  ALL_ACTIONS_FILTER,
  BAD_DRAFT,
  build,
  CONFIGURATION,
  codecFor,
  committed,
  cleared,
  defaultRegistry,
  defaultWorld,
  DESCRIPTOR,
  doubles,
  DRAFT,
  HEADER,
  members,
  METHOD_A,
  METHOD_B,
  METHOD_C,
  methodStub,
  MODULE_ANSWERS,
  OTHER_ACTION,
  PIN,
  position,
  revert,
  transportFailure,
} from './doubles';

/** The context the client should hand the pure judgment, built from what the doubles answer. */
function expectedContext(
  draft: SetupDraft,
  overrides: {
    readonly action?: Address;
    readonly actionInfo?: ReadResult<ActionInfo>;
    readonly managerEvents?: readonly KitNotification[];
    readonly registry?: MethodRegistry;
    readonly accountHoldsCode?: boolean;
  } = {},
): SetupValidationContext {
  const registry = overrides.registry ?? defaultRegistry();
  const distinct = [...new Set(draft.clauses.flatMap((clause) => clause.credentials.map((credential) => credential.method)))];

  return {
    account: ACCOUNT,
    descriptor: DESCRIPTOR,
    descriptorOrigin: 'integrator',
    configuration: CONFIGURATION,
    block: HEADER,
    methods: distinct.map((module) => ({ module, ...MODULE_ANSWERS, implemented: registry.has(module), ...codecOf(registry, module) })),
    action: {
      address: overrides.action ?? ACTION,
      actionInfo: overrides.actionInfo ?? { answered: true, value: ACTION_INFO },
      supportsAccount: true,
      accountHoldsCode: overrides.accountHoldsCode ?? true,
    },
    managerEvents: overrides.managerEvents ?? [],
    costs: [],
  };
}

/** The reads' codec member for a registered implementation whose codec has a decodeConfig function, as the client should add it. */
function codecOf(registry: MethodRegistry, module: Address): { readonly codec?: IRecoveryMethod['codec'] } {
  const codec = registry.get(module)?.codec;

  return typeof codec?.decodeConfig === 'function' ? { codec } : {};
}

/** A wallet config word and a passkey config of three words, each one its codec decodes. */
const WALLET_WORD: Hex = `0x${'00'.repeat(12)}${'ab'.repeat(20)}`;
const PASSKEY_WORDS: Hex = `0x${'00'.repeat(31)}01${'00'.repeat(31)}02${'cd'.repeat(32)}`;

const THREE_METHODS: SetupDraft = {
  ...DRAFT,
  clauses: [
    {
      threshold: 2,
      credentials: [
        { method: METHOD_A, config: '0x01' },
        { method: METHOD_A, config: '0x02' },
        { method: METHOD_B, config: '0x03' },
        { method: METHOD_C, config: '0x04' },
      ],
    },
  ],
};

describe('validateSetup', () => {
  it('answers what the pure judgment answers over the reads the doubles gave', async () => {
    const { client } = build();

    expect(await client.validateSetup(DRAFT)).toEqual(validateSetup(DRAFT, expectedContext(DRAFT)));
  });

  it('reads each distinct method once, every read at the pinned block, and marks unregistered methods', async () => {
    const { client, seen } = build();
    const result = await client.validateSetup(THREE_METHODS);

    expect(result).toEqual(validateSetup(THREE_METHODS, expectedContext(THREE_METHODS)));

    for (const member of ['moduleInfo', 'paused', 'trustedParties']) {
      const modules = seen.parts.filter((part) => part.member === member).map((part) => part.args[0]);

      expect(modules.map((module) => String(module).toLowerCase()).sort()).toEqual(
        [METHOD_A, METHOD_B, METHOD_C].map((module) => module.toLowerCase()).sort(),
      );
    }

    expect(result.warnings.find((warning) => warning.code === 'method.unshipped')?.values).toMatchObject({ implemented: false });
  });

  it('pins one block at the read tag and passes it to every part call', async () => {
    const { client, seen } = build();

    await client.validateSetup(DRAFT);

    expect(seen.blockTags).toEqual(['latest']);

    for (const call of seen.parts.filter((part) => part.part !== 'events')) {
      expect(call.args[call.args.length - 1], `${call.part}.${call.member}`).toEqual(PIN);
    }
  });

  it('makes one account-wide log read from the deployment block to the pinned block, and reads no stateOf', async () => {
    const { client, seen } = build();

    await client.validateSetup(DRAFT);

    expect(seen.fetches).toEqual([{ filter: ALL_ACTIONS_FILTER, range: { from: DESCRIPTOR.deployedAt, to: PIN.number } }]);
    expect(members(seen)).not.toContain('manager.stateOf');
  });

  it("warns manager.already-armed where another action's last setup event is a commit", async () => {
    const managerEvents = [committed(1n, `0x${'01'.repeat(32)}`, '0x', position(200), OTHER_ACTION)];
    const { client } = build({ world: { allActions: managerEvents } });
    const result = await client.validateSetup(DRAFT);
    const armed = result.warnings.filter((warning) => warning.code === 'manager.already-armed');

    expect(armed).toHaveLength(1);
    expect(armed[0]?.values).toMatchObject({ action: OTHER_ACTION });
    expect(result).toEqual(validateSetup(DRAFT, expectedContext(DRAFT, { managerEvents })));
  });

  it('does not warn where the other action was committed then cleared', async () => {
    const managerEvents = [
      committed(1n, `0x${'01'.repeat(32)}`, '0x', position(200), OTHER_ACTION),
      cleared(2n, position(300), OTHER_ACTION),
    ];
    const { client } = build({ world: { allActions: managerEvents } });
    const result = await client.validateSetup(DRAFT);

    expect(result.warnings.map((warning) => warning.code)).not.toContain('manager.already-armed');
  });

  it.each([
    ['a revert', revert('0x')],
    ['an undecodable answer', new TypeError('name is not a string')],
    ['a transport failure', transportFailure()],
  ])('reads actionInfo rejecting with %s as unanswered', async (_name, rejection) => {
    const { client } = build({ action: OTHER_ACTION, world: { actionInfo: { rejects: rejection } } });
    const result = await client.validateSetup(DRAFT);

    expect(result).toEqual(
      validateSetup(DRAFT, expectedContext(DRAFT, { action: OTHER_ACTION, actionInfo: { answered: false } })),
    );
    expect(result.warnings.find((warning) => warning.code === 'action.unaudited')?.values).toMatchObject({ probeAnswered: false });
  });

  it('never throws on a finding', async () => {
    const result = await build().client.validateSetup(BAD_DRAFT);

    expect(result.errors.map((error) => error.code)).toContain('clause.threshold-above-count');
  });

  it('places a method in the tier its registered implementation states', async () => {
    const registry: MethodRegistry = new Map([
      [METHOD_A, methodStub([METHOD_A], 'secondary')],
      [METHOD_B, methodStub([METHOD_B])],
    ]);
    const draft: SetupDraft = { ...DRAFT, clauses: [{ threshold: 1, credentials: [{ method: METHOD_A, config: '0x01' }] }] };
    const { client } = build({ methods: registry });
    const result = await client.validateSetup(draft);
    const context = expectedContext(draft, { registry });

    expect(result.warnings.map((warning) => warning.code)).toContain('clause.secondary-only');
    expect(result).toEqual(validateSetup(draft, { ...context, methods: context.methods.map((reads) => ({ ...reads, tier: 'secondary' as const })) }));
    expect((await client.describeSetup(draft)).methodStanding).toEqual([expect.objectContaining({ method: METHOD_A, tier: 'secondary' })]);
  });

  it('leaves the tier absent for an implementation that states none', async () => {
    const draft: SetupDraft = { ...DRAFT, clauses: [{ threshold: 1, credentials: [{ method: METHOD_B, config: '0x01' }] }] };
    const standing = (await build().client.describeSetup(draft)).methodStanding;

    expect(standing).toHaveLength(1);
    expect('tier' in (standing[0] ?? {})).toBe(false);
  });

  it('passes the integrator origin derived from a descriptor of its own', async () => {
    const result = await build({ action: OTHER_ACTION }).client.validateSetup(DRAFT);

    expect(result.warnings.find((warning) => warning.code === 'action.unaudited')?.values).toMatchObject({
      descriptorOrigin: 'integrator',
    });
  });

  it('passes the kit origin derived from the shipped default descriptor', async () => {
    const made = doubles(defaultWorld());
    const client = new SetupClient(
      made.provider,
      BUILDER_SEPOLIA_DESCRIPTOR,
      ACCOUNT,
      OTHER_ACTION,
      CONFIGURATION,
      made.manager,
      made.action,
      made.events,
      defaultRegistry(),
      codecFor(OTHER_ACTION),
    );
    const result = await client.validateSetup(DRAFT);

    expect(result.warnings.find((warning) => warning.code === 'action.unaudited')?.values).toMatchObject({
      descriptorOrigin: 'kit',
    });
  });

  it('reads supportsAccount but no authority on a code-less account', async () => {
    const { client, seen } = build({ world: { code: '0x' } });

    await client.validateSetup(DRAFT);

    expect(members(seen)).toContain('action.supportsAccount');
    expect(members(seen)).not.toContain('action.isAuthorized');
    expect(members(seen)).not.toContain('action.isAuthority');
  });

  it('rejects with a failed log read as itself', async () => {
    const failure = transportFailure();

    await expect(build({ world: { allActions: { rejects: failure } } }).client.validateSetup(DRAFT)).rejects.toBe(failure);
  });

  it('a registry of the shipped methods: a config its method cannot decode is credential.config-malformed', async () => {
    const registry: MethodRegistry = new Map<Address, IRecoveryMethod>([
      [METHOD_A, walletMethod()],
      [METHOD_B, passkeyMethod()],
    ]);
    const bare: Hex = `0x${'ab'.repeat(20)}`;
    const draft: SetupDraft = {
      ...DRAFT,
      clauses: [
        { threshold: 1, credentials: [{ method: METHOD_A, config: WALLET_WORD }, { method: METHOD_B, config: WALLET_WORD }] },
        { threshold: 1, credentials: [{ method: METHOD_A, config: bare }, { method: METHOD_B, config: PASSKEY_WORDS }] },
      ],
    };
    const result = await build({ methods: registry }).client.validateSetup(draft);

    expect(result.errors.filter((finding) => finding.code === 'credential.config-malformed')).toEqual([
      { code: 'credential.config-malformed', subject: 'credential', values: { place: 1, module: METHOD_B, bytes: 32 } },
      { code: 'credential.config-malformed', subject: 'credential', values: { place: 2, module: METHOD_A, bytes: 20 } },
    ]);
    expect(result).toEqual(validateSetup(draft, expectedContext(draft, { registry })));
  });

  it('the stub registry, whose codecs accept every config, raises no malformed config and hands its decoder on', async () => {
    const draft: SetupDraft = {
      ...DRAFT,
      clauses: [{ threshold: 1, credentials: [{ method: METHOD_A, config: '0x01' }, { method: METHOD_B, config: `0x${'ab'.repeat(20)}` }] }],
    };
    const result = await build().client.validateSetup(draft);

    expect(result.errors.map((finding) => finding.code)).not.toContain('credential.config-malformed');
    expect(result).toEqual(validateSetup(draft, expectedContext(draft)));
    expect(expectedContext(draft).methods.map((reads) => reads.codec?.decodeConfig)).toEqual([ACCEPT_EVERY_CONFIG, ACCEPT_EVERY_CONFIG]);
  });

  describe.each([
    ['an empty codec', {}],
    ['a codec whose decodeConfig is a string', { decodeConfig: 'decode' }],
  ])('a registered implementation with %s', (_why, codec) => {
    const registry = (): MethodRegistry =>
      new Map<Address, IRecoveryMethod>([
        [METHOD_A, { ...methodStub([METHOD_A]), codec: codec as IRecoveryMethod['codec'] }],
        [METHOD_B, methodStub([METHOD_B])],
      ]);
    const draft: SetupDraft = { ...DRAFT, clauses: [{ threshold: 1, credentials: [{ method: METHOD_A, config: WALLET_WORD }] }] };

    it('makes validateSetup reject with a TypeError', async () => {
      await expect(build({ methods: registry() }).client.validateSetup(draft)).rejects.toThrow(TypeError);
    });

    it('makes describeSetup reject with a TypeError', async () => {
      await expect(build({ methods: registry() }).client.describeSetup(draft)).rejects.toThrow(TypeError);
    });
  });

  it('a module no implementation is registered for still gets no judgment', async () => {
    const draft: SetupDraft = { ...DRAFT, clauses: [{ threshold: 1, credentials: [{ method: METHOD_C, config: '0x04' }] }] };
    const result = await build().client.validateSetup(draft);

    expect(result.errors.map((finding) => finding.code)).not.toContain('credential.config-malformed');
    expect(expectedContext(draft).methods).toEqual([expect.not.objectContaining({ codec: expect.anything() })]);
    expect(result).toEqual(validateSetup(draft, expectedContext(draft)));
  });
});
