import { getAddress } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AmbireActionCodec,
  AmbireRecoveryAction,
  BUILDER_DEFAULT_CONFIGURATION,
  BUILDER_MODULE_CLAIMED_MESSAGE,
  DEVICE_BINDINGS,
  EventManager,
  MethodsOrchestrator,
  PolicyManager,
  RecoveryClient,
  SetupClient,
  SocialRecoveryBuilder,
  passkeyMethod,
  walletMethod,
  type IActionCodec,
  type MethodRegistry,
  type RecoveryActionContext,
} from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  ChainDouble,
  DESCRIPTOR,
  EXTRA_MODULE,
  METHOD_ECDSA,
  METHOD_PASSKEY,
  OTHER_ACTION,
  ZERO,
  actionStub,
  codecServing,
  eventsStub,
  failureOf,
  goodDomain,
  goodWorld,
  holder,
  managerStub,
  methodServing,
  signerRecoveryStub,
  callsOf,
} from './doubles';

const made = vi.hoisted(() => new Map<string, { readonly instance: object; readonly args: readonly unknown[] }[]>());

/** Wraps a class so every construction is recorded with its arguments. */
const recorded = vi.hoisted(
  () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <T extends new (...args: any[]) => object>(name: string, base: T): T =>
      class extends base {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(...args: any[]) {
          super(...args);
          made.set(name, [...(made.get(name) ?? []), { instance: this, args }]);
        }
      },
);

vi.mock('../../src/policy-manager/policy-manager', async (original) => {
  const actual = await original<typeof import('../../src/policy-manager/policy-manager')>();

  return { ...actual, PolicyManager: recorded('PolicyManager', actual.PolicyManager) };
});

vi.mock('../../src/event-manager/event-manager', async (original) => {
  const actual = await original<typeof import('../../src/event-manager/event-manager')>();

  return { ...actual, EventManager: recorded('EventManager', actual.EventManager) };
});

vi.mock('../../src/recovery-action/action', async (original) => {
  const actual = await original<typeof import('../../src/recovery-action/action')>();

  return { ...actual, AmbireRecoveryAction: recorded('AmbireRecoveryAction', actual.AmbireRecoveryAction) };
});

vi.mock('../../src/recovery-action/codec', async (original) => {
  const actual = await original<typeof import('../../src/recovery-action/codec')>();

  return { ...actual, AmbireActionCodec: recorded('AmbireActionCodec', actual.AmbireActionCodec) };
});

vi.mock('../../src/setup-client/setup-client', async (original) => {
  const actual = await original<typeof import('../../src/setup-client/setup-client')>();

  return { ...actual, SetupClient: recorded('SetupClient', actual.SetupClient) };
});

vi.mock('../../src/recovery-client/client', async (original) => {
  const actual = await original<typeof import('../../src/recovery-client/client')>();

  return { ...actual, RecoveryClient: recorded('RecoveryClient', actual.RecoveryClient) };
});

vi.mock('../../src/methods-orchestrator/orchestrator', async (original) => {
  const actual = await original<typeof import('../../src/methods-orchestrator/orchestrator')>();

  return { ...actual, MethodsOrchestrator: recorded('MethodsOrchestrator', actual.MethodsOrchestrator) };
});

/** The constructions of one class so far. */
const of = (name: string) => made.get(name) ?? [];

/** The arguments of the only construction of one class. */
function only(name: string): readonly unknown[] {
  const list = of(name);

  expect(list, name).toHaveLength(1);

  return list[0]!.args;
}

/** The setup client's arguments by name, the descriptor origin no longer among them. */
const setupArgs = () => {
  const [provider, descriptor, account, action, configuration, policyManager, recoveryAction, events, methods, codec, signerRecovery, versionEscaped] =
    only('SetupClient');

  return { provider, descriptor, account, action, configuration, policyManager, recoveryAction, events, methods, codec, signerRecovery, versionEscaped };
};

const recoveryArgs = () => {
  const [provider, descriptor, account, action, configuration, policyManager, recoveryAction, events, methods, codec, signerRecovery, versionEscaped] =
    only('RecoveryClient');

  return { provider, descriptor, account, action, configuration, policyManager, recoveryAction, events, methods, codec, signerRecovery, versionEscaped };
};

/** The registry's keys, checksummed and sorted. */
const keysOf = (methods: MethodRegistry) => [...methods.keys()].map((key) => getAddress(key)).sort();

/** The registry entry for a module, whatever case the key carries. */
const entryOf = (methods: MethodRegistry, module: string) => [...methods.entries()].find(([key]) => getAddress(key) === getAddress(module))?.[1];

const orchestratorArgs = () => {
  const [methods, codecs, bindings] = only('MethodsOrchestrator');

  return { methods: methods as MethodRegistry, codecs: codecs as ReadonlyMap<string, IActionCodec>, bindings };
};

beforeEach(() => {
  made.clear();
});

type HolderBuilder = ReturnType<typeof SocialRecoveryBuilder.from<ReturnType<typeof holder>>>;

/** The record with one more own member, non-enumerable, so `Object.keys` does not list it. */
const hidden = (record: object, key: string): object => Object.defineProperty({ ...record }, key, { value: {} });

describe('the parts the builder constructs', () => {
  it('constructs each shared part once and hands the same instances to both clients', async () => {
    await SocialRecoveryBuilder.from(holder()).build();

    const setup = setupArgs();
    const recovery = recoveryArgs();
    const orchestrator = orchestratorArgs();

    expect(of('PolicyManager')).toHaveLength(1);
    expect(of('EventManager')).toHaveLength(1);
    expect(of('AmbireRecoveryAction')).toHaveLength(1);
    expect(setup.policyManager).toBe(of('PolicyManager')[0]!.instance);
    expect(recovery.policyManager).toBe(setup.policyManager);
    expect(setup.recoveryAction).toBe(of('AmbireRecoveryAction')[0]!.instance);
    expect(recovery.recoveryAction).toBe(setup.recoveryAction);
    expect(setup.events).toBe(of('EventManager')[0]!.instance);
    expect(recovery.events).toBe(setup.events);
    expect(recovery.codec).toBe(setup.codec);
    expect(recovery.methods).toBe(setup.methods);
    expect(orchestrator.methods).toBe(setup.methods);
    expect(only('EventManager')[4]).toBe(setup.methods);
    expect(orchestrator.codecs.get(ACTION)).toBe(setup.codec);
  });

  it('hands every part the builder\'s own provider, descriptor, account and action', async () => {
    const provider = new ChainDouble();

    await SocialRecoveryBuilder.from(holder(provider)).build();

    for (const name of ['PolicyManager', 'EventManager', 'AmbireRecoveryAction', 'SetupClient', 'RecoveryClient']) {
      const [givenProvider, descriptor, account, action] = only(name);

      expect(givenProvider, name).toBe(provider);
      expect(descriptor, name).toEqual(DESCRIPTOR);
      expect(getAddress(account as string), name).toBe(ACCOUNT);
      expect(getAddress(action as string), name).toBe(ACTION);
    }

    expect(only('PolicyManager')[4]).toEqual({ read: 'latest', watch: 'finalized' });
    expect(only('AmbireRecoveryAction')[5]).toEqual({ read: 'latest', watch: 'finalized' });
  });

  it('constructs the default codec over the bound action and hands it to the action part', async () => {
    await SocialRecoveryBuilder.from(holder()).buildSetupClient();

    expect(of('AmbireActionCodec').map((entry) => (entry.args[0] as string[]).map((a) => getAddress(a)))).toEqual([[ACTION]]);
    expect(setupArgs().codec).toBe(of('AmbireActionCodec')[0]!.instance);
    expect(only('AmbireRecoveryAction')[4]).toBe(setupArgs().codec);
  });

  it('registers the wallet and passkey methods on the descriptor\'s modules', async () => {
    await SocialRecoveryBuilder.from(holder()).build();

    expect([...orchestratorArgs().methods.keys()].map((key) => getAddress(key))).toEqual([METHOD_ECDSA, METHOD_PASSKEY]);
  });

  it('skips a module the descriptor names as the zero address', async () => {
    const descriptor = { ...DESCRIPTOR, methodPasskey: ZERO };

    await SocialRecoveryBuilder.from(holder(new ChainDouble(goodWorld(descriptor)), descriptor)).build();

    expect([...orchestratorArgs().methods.keys()].map((key) => getAddress(key))).toEqual([METHOD_ECDSA]);
    expect(setupArgs().methods).toBe(orchestratorArgs().methods);
  });

  it('adds a method the integrator registers', async () => {
    await SocialRecoveryBuilder.from(holder()).withMethod(methodServing([EXTRA_MODULE])).build();

    expect([...orchestratorArgs().methods.keys()].map((key) => getAddress(key)).sort()).toEqual([METHOD_ECDSA, METHOD_PASSKEY, EXTRA_MODULE].sort());
  });

  it('refuses a module two added implementations claim with a TypeError at the first build', async () => {
    const thrown = await failureOf(() =>
      SocialRecoveryBuilder.from(holder()).withMethod(methodServing([EXTRA_MODULE])).withMethod(methodServing([EXTRA_MODULE])).build(),
    );

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toContain(BUILDER_MODULE_CLAIMED_MESSAGE);
    expect(of('SetupClient')).toHaveLength(0);
  });

  it('refuses two added implementations claiming a default module', async () => {
    const thrown = await failureOf(() =>
      SocialRecoveryBuilder.from(holder()).withMethod(methodServing([METHOD_ECDSA])).withMethod(walletMethod()).build(),
    );

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toContain(BUILDER_MODULE_CLAIMED_MESSAGE);
  });

  it.each([
    ['the wallet module', METHOD_ECDSA, METHOD_PASSKEY],
    ['the passkey module', METHOD_PASSKEY, METHOD_ECDSA],
  ])('lets an added method claiming %s replace the shipped one there alone', async (_name, claimed, kept) => {
    const added = methodServing([claimed]);

    await SocialRecoveryBuilder.from(holder()).withMethod(added).build();

    const methods = orchestratorArgs().methods;

    expect(keysOf(methods)).toEqual([METHOD_ECDSA, METHOD_PASSKEY].sort());
    expect(entryOf(methods, claimed)).toBe(added);
    expect(entryOf(methods, kept)).not.toBe(added);
    expect(entryOf(methods, kept)?.deviceBinding).toBe((claimed === METHOD_ECDSA ? passkeyMethod() : walletMethod()).deviceBinding);
    expect(entryOf(setupArgs().methods as MethodRegistry, claimed)).toBe(added);
    expect(entryOf(recoveryArgs().methods as MethodRegistry, claimed)).toBe(added);
  });

  it('lets a shipped implementation registered again replace the default instance', async () => {
    const [wallet, passkey] = [walletMethod(), passkeyMethod()];

    await SocialRecoveryBuilder.from(holder()).withMethod(wallet).withMethod(passkey).build();

    expect(entryOf(orchestratorArgs().methods, METHOD_ECDSA)).toBe(wallet);
    expect(entryOf(orchestratorArgs().methods, METHOD_PASSKEY)).toBe(passkey);
  });

  it('lets one added method take both default modules and a new one', async () => {
    const added = methodServing([METHOD_ECDSA, METHOD_PASSKEY, EXTRA_MODULE]);

    await SocialRecoveryBuilder.from(holder()).withMethod(added).build();

    const methods = orchestratorArgs().methods;

    expect(keysOf(methods)).toEqual([METHOD_ECDSA, METHOD_PASSKEY, EXTRA_MODULE].sort());

    for (const module of [METHOD_ECDSA, METHOD_PASSKEY, EXTRA_MODULE]) expect(entryOf(methods, module)).toBe(added);
  });

  it('keeps the shipped method on its module when the added one claims another module', async () => {
    const added = methodServing([METHOD_ECDSA, EXTRA_MODULE]);

    await SocialRecoveryBuilder.from(holder()).withMethod(added).build();

    const methods = orchestratorArgs().methods;

    expect(keysOf(methods)).toEqual([METHOD_ECDSA, METHOD_PASSKEY, EXTRA_MODULE].sort());
    expect(entryOf(methods, EXTRA_MODULE)).toBe(added);
    expect(entryOf(methods, METHOD_PASSKEY)).not.toBe(added);
  });

  it('constructs nothing while the setters run', () => {
    SocialRecoveryBuilder.from(holder()).withEventManager({ logChunkSize: 7 }).withCodec({ actions: [OTHER_ACTION] }).withRecoveryAction(OTHER_ACTION);

    expect([...made.values()].flat()).toEqual([]);
  });
});

describe('the configuration', () => {
  it('is the shipped default when none is given', async () => {
    await SocialRecoveryBuilder.from(holder()).build();

    expect(setupArgs().configuration).toEqual(BUILDER_DEFAULT_CONFIGURATION);
    expect(recoveryArgs().configuration).toEqual(BUILDER_DEFAULT_CONFIGURATION);
    expect(only('EventManager')[5]).toMatchObject({ logChunkSize: 10_000 });
  });

  it('merges a partial configuration over the default member by member', async () => {
    const partial = { tokens: [EXTRA_MODULE], requestWindow: { default: 7_200, floor: 600 }, blockTags: { read: 'finalized', watch: 'latest' } } as const;

    await SocialRecoveryBuilder.from({ ...holder(), configuration: partial }).buildSetupClient();

    expect(setupArgs().configuration).toEqual({ ...BUILDER_DEFAULT_CONFIGURATION, ...partial });
  });

  it('takes the event manager\'s chunk width from its options alone', async () => {
    await SocialRecoveryBuilder.from({ ...holder(), configuration: { logChunkSize: 2_000 } }).withEventManager({ logChunkSize: 500 }).build();

    expect(only('EventManager')[5]).toMatchObject({ logChunkSize: 500 });
    expect(setupArgs().configuration).toMatchObject({ logChunkSize: 2_000 });
  });

  it('takes the event manager\'s chunk width from the configuration without options', async () => {
    await SocialRecoveryBuilder.from({ ...holder(), configuration: { logChunkSize: 2_000 } }).buildSetupClient();

    expect(only('EventManager')[5]).toMatchObject({ logChunkSize: 2_000 });
  });
});

describe('the parts the integrator supplies', () => {
  it('uses a supplied policy manager and still reads the manager through the provider', async () => {
    const manager = managerStub();
    const provider = new ChainDouble();

    await SocialRecoveryBuilder.from(holder(provider)).withPolicyManager(manager).build();

    expect(of('PolicyManager')).toHaveLength(0);
    expect(setupArgs().policyManager).toBe(manager);
    expect(recoveryArgs().policyManager).toBe(manager);
    expect(provider.reads).toEqual(['chainId', 'eip712Domain', 'version']);
    expect(callsOf(manager, 'eip712Domain')).toHaveLength(0);
  });

  it('uses a supplied event manager and constructs none', async () => {
    const events = eventsStub();

    await SocialRecoveryBuilder.from(holder()).withEventManager(events).build();

    expect(of('EventManager')).toHaveLength(0);
    expect(setupArgs().events).toBe(events);
  });

  it('uses a supplied action part at its address', async () => {
    const action = actionStub();

    await SocialRecoveryBuilder.from(holder()).withRecoveryAction(OTHER_ACTION, action).build();

    expect(of('AmbireRecoveryAction')).toHaveLength(0);
    expect(setupArgs().recoveryAction).toBe(action);
    expect(getAddress(setupArgs().action as string)).toBe(OTHER_ACTION);
    expect((setupArgs().codec as IActionCodec).actions.map((a) => getAddress(a))).toEqual([OTHER_ACTION]);
  });

  it('constructs the shipped action at the address given without an implementation', async () => {
    await SocialRecoveryBuilder.from(holder()).withRecoveryAction(OTHER_ACTION).buildSetupClient();

    expect(getAddress(only('AmbireRecoveryAction')[3] as string)).toBe(OTHER_ACTION);
    expect(getAddress(setupArgs().action as string)).toBe(OTHER_ACTION);
  });

  it('calls an action factory once with the builder\'s own context', async () => {
    const action = actionStub();
    const factory = vi.fn<(context: RecoveryActionContext) => typeof action>(() => action);
    const provider = new ChainDouble();
    const builder = SocialRecoveryBuilder.from(holder(provider)).withRecoveryAction(OTHER_ACTION, factory);

    await builder.build();
    await builder.recoveryAction();

    expect(factory).toHaveBeenCalledTimes(1);

    const context = factory.mock.calls[0]![0];

    expect(context.provider).toBe(provider);
    expect(context.descriptor).toEqual(DESCRIPTOR);
    expect(getAddress(context.account)).toBe(ACCOUNT);
    expect(getAddress(context.action)).toBe(OTHER_ACTION);
    expect(context.codec.actions.map((a) => getAddress(a))).toContain(OTHER_ACTION);
    expect(context.blockTags).toEqual({ read: 'latest', watch: 'finalized' });
    expect(setupArgs().recoveryAction).toBe(action);
    expect(recoveryArgs().recoveryAction).toBe(action);
  });

  it('hands both clients the registered codec serving the bound action', async () => {
    const codec = codecServing(ACTION);

    await SocialRecoveryBuilder.from(holder()).withCodec(codec).build();

    expect(setupArgs().codec).toBe(codec);
    expect(recoveryArgs().codec).toBe(codec);
    expect(orchestratorArgs().codecs.get(ACTION)).toBe(codec);
  });

  it('adds codecs, constructing the options form at the first build', async () => {
    const other = codecServing(EXTRA_MODULE);

    await SocialRecoveryBuilder.from(holder()).withCodec({ actions: [OTHER_ACTION] }).withCodec(other).build();

    const codecs = orchestratorArgs().codecs;

    expect([...codecs.keys()].map((key) => getAddress(key)).sort()).toEqual([ACTION, OTHER_ACTION, EXTRA_MODULE].sort());
    expect(codecs.get(EXTRA_MODULE)).toBe(other);
    expect(codecs.get(OTHER_ACTION)).toBeInstanceOf(AmbireActionCodec);
    expect((setupArgs().codec as IActionCodec).actions.map((a) => getAddress(a))).toEqual([ACTION]);
  });

  it('picks the codec serving an action moved by withRecoveryAction', async () => {
    const codec = codecServing(OTHER_ACTION);

    await SocialRecoveryBuilder.from(holder()).withCodec(codec).withRecoveryAction(OTHER_ACTION).build();

    expect(setupArgs().codec).toBe(codec);
    expect(only('AmbireRecoveryAction')[4]).toBe(codec);
  });

  it('hands the signer recovery to both clients', async () => {
    const signerRecovery = signerRecoveryStub();

    await SocialRecoveryBuilder.from(holder()).withSignerRecovery(signerRecovery).build();

    expect(setupArgs().signerRecovery).toBe(signerRecovery);
    expect(recoveryArgs().signerRecovery).toBe(signerRecovery);
  });

  it('refuses malformed options at the call', () => {
    const builder = SocialRecoveryBuilder.from(holder());

    for (const set of [
      () => builder.withEventManager({ logChunkSize: 0 }),
      () => builder.withEventManager({ logChunkSize: 1.5 }),
      () => builder.withEventManager({} as never),
      () => builder.withEventManager(null as never),
      () => builder.withCodec({ actions: [] }),
      () => builder.withCodec({ actions: ['0x1234'] } as never),
      () => builder.withCodec({ actions: [ACTION, ACTION] }),
      // eslint-disable-next-line no-sparse-arrays
      () => builder.withCodec({ actions: [ACTION, , OTHER_ACTION] } as never),
      () => builder.withCodec(null as never),
      () => builder.withRecoveryAction('0x1234'),
      () => builder.withRecoveryAction(ACTION, 'part' as never),
      () => builder.withRecoveryAction(ACTION, {} as never),
    ]) {
      expect(set).toThrow(expect.objectContaining({ name: expect.stringMatching(/^(TypeError|RangeError)$/) }));
    }

    expect([...made.values()].flat()).toEqual([]);
  });

  it.each([
    ['a policy manager missing its members', (builder: ReturnType<typeof SocialRecoveryBuilder.from<ReturnType<typeof holder>>>) => builder.withPolicyManager({} as never)],
    ['a policy manager given as options', (builder: ReturnType<typeof SocialRecoveryBuilder.from<ReturnType<typeof holder>>>) => builder.withPolicyManager({ logChunkSize: 5 } as never)],
    ['a method missing its members', (builder: ReturnType<typeof SocialRecoveryBuilder.from<ReturnType<typeof holder>>>) => builder.withMethod({} as never)],
    ['a signer recovery missing its member', (builder: ReturnType<typeof SocialRecoveryBuilder.from<ReturnType<typeof holder>>>) => builder.withSignerRecovery({} as never)],
  ])('refuses %s with a TypeError at the call or at the first build', async (_name, set) => {
    const builder = SocialRecoveryBuilder.from(holder());
    const thrown = await failureOf(async () => {
      set(builder);
      await builder.build();
    });

    expect(thrown).toBeInstanceOf(TypeError);
  });

  it('refuses an options object carrying a member of its own', () => {
    const builder = SocialRecoveryBuilder.from(holder());

    expect(() => builder.withEventManager({ logChunkSize: 5, provider: new ChainDouble() } as never)).toThrow(TypeError);
    expect(() => builder.withCodec({ actions: [ACTION], descriptor: DESCRIPTOR } as never)).toThrow(TypeError);
  });

  it.each([
    ['withEventManager', 'a hidden string key', (builder: HolderBuilder) => builder.withEventManager(hidden({ logChunkSize: 5 }, 'provider') as never)],
    ['withEventManager', 'a symbol key', (builder: HolderBuilder) => builder.withEventManager({ logChunkSize: 5, [Symbol('provider')]: 1 } as never)],
    ['withCodec', 'a hidden string key', (builder: HolderBuilder) => builder.withCodec(hidden({ actions: [ACTION] }, 'provider') as never)],
    ['withCodec', 'a symbol key', (builder: HolderBuilder) => builder.withCodec({ actions: [ACTION], [Symbol('provider')]: 1 } as never)],
  ])('%s refuses options carrying %s of its own with a TypeError naming it at the call', (_setter, _kind, set) => {
    const provider = new ChainDouble();
    const builder = SocialRecoveryBuilder.from(holder(provider));
    let thrown: unknown;

    try {
      set(builder);
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toContain('provider');
    expect(provider.reads).toEqual([]);
    expect([...made.values()].flat()).toEqual([]);
  });

  it('accepts options inheriting an unknown member', async () => {
    const events = Object.assign(Object.create({ provider: new ChainDouble() }) as object, { logChunkSize: 5 });
    const codec = Object.assign(Object.create({ descriptor: DESCRIPTOR }) as object, { actions: [OTHER_ACTION] });

    await SocialRecoveryBuilder.from(holder()).withEventManager(events as never).withCodec(codec as never).build();

    expect(only('EventManager')[5]).toMatchObject({ logChunkSize: 5 });
  });
});

describe('a codec instance', () => {
  it.each([
    ['a malformed address', ['0x1234']],
    ['a list with an undefined entry', [ACTION, undefined]],
    ['not a list', ACTION],
  ])('whose actions are %s is refused with a TypeError at the call, before any read', (_name, actions) => {
    const provider = new ChainDouble();
    const builder = SocialRecoveryBuilder.from(holder(provider));

    expect(() => builder.withCodec({ ...codecServing(ACTION), actions } as never)).toThrow(TypeError);
    expect(provider.reads).toEqual([]);
    expect([...made.values()].flat()).toEqual([]);
    expect(builder.withVersionEscape()).toBe(builder);
  });

  it('with an empty list is refused with a RangeError at the call, like the options form, before any read', () => {
    const provider = new ChainDouble();
    const builder = SocialRecoveryBuilder.from(holder(provider));

    expect(() => builder.withCodec({ actions: [] })).toThrow(RangeError);
    expect(() => builder.withCodec({ ...codecServing(ACTION), actions: [] })).toThrow(RangeError);
    expect(provider.reads).toEqual([]);
    expect([...made.values()].flat()).toEqual([]);
    expect(builder.withVersionEscape()).toBe(builder);
  });

  it('with a list naming one address twice is refused with a RangeError at the call, like the options form', () => {
    const builder = SocialRecoveryBuilder.from(holder());

    expect(() => builder.withCodec({ actions: [ACTION, ACTION] })).toThrow(RangeError);
    expect(() => builder.withCodec({ ...codecServing(ACTION), actions: [ACTION, ACTION.toLowerCase()] } as never)).toThrow(RangeError);
    expect(() => builder.withCodec({ actions: [ACTION, ACTION.toLowerCase()] } as never)).toThrow(RangeError);
  });

  it.each([
    ['not a list', ACTION],
    ['a malformed address', ['0x1234']],
  ])('whose actions are %s is refused with a TypeError in the options form too', (_name, actions) => {
    expect(() => SocialRecoveryBuilder.from(holder()).withCodec({ actions } as never)).toThrow(TypeError);
  });

  it('registered twice builds and keys one entry per action it serves', async () => {
    const codec = codecServing(ACTION, OTHER_ACTION);

    await SocialRecoveryBuilder.from(holder()).withCodec(codec).withCodec(codec).build();

    const codecs = orchestratorArgs().codecs;

    expect([...codecs.keys()].map((key) => getAddress(key)).sort()).toEqual([ACTION, OTHER_ACTION].sort());

    for (const value of codecs.values()) expect(value).toBe(codec);

    expect(setupArgs().codec).toBe(codec);
    expect(recoveryArgs().codec).toBe(codec);
  });

  it('is still refused at the first build where another codec serves one of its actions', async () => {
    const twoInstances = SocialRecoveryBuilder.from(holder()).withCodec(codecServing(OTHER_ACTION)).withCodec(codecServing(OTHER_ACTION));
    const instanceAndOptions = SocialRecoveryBuilder.from(holder()).withCodec({ actions: [OTHER_ACTION] }).withCodec(codecServing(OTHER_ACTION));

    expect(await failureOf(() => twoInstances.build())).toBeInstanceOf(TypeError);
    expect(await failureOf(() => instanceAndOptions.build())).toBeInstanceOf(TypeError);
    expect(twoInstances.withVersionEscape()).toBe(twoInstances);
  });
});

describe('a method instance registered twice', () => {
  it('builds and keys its module once', async () => {
    const method = methodServing([EXTRA_MODULE]);

    await SocialRecoveryBuilder.from(holder()).withMethod(method).withMethod(method).build();

    expect(entryOf(orchestratorArgs().methods, EXTRA_MODULE)).toBe(method);
    expect(keysOf(orchestratorArgs().methods)).toEqual([METHOD_ECDSA, METHOD_PASSKEY, EXTRA_MODULE].sort());
  });
});

describe('the escape reaching the clients', () => {
  it('marks both clients escaped where an escapable check failed', async () => {
    await SocialRecoveryBuilder.from(holder(new ChainDouble({ ...goodWorld(), domain: { ...goodDomain(), name: 'Other' } })))
      .withVersionEscape()
      .build();

    expect(setupArgs().versionEscaped).toBe(true);
    expect(recoveryArgs().versionEscaped).toBe(true);
  });

  it('leaves both clients unescaped where nothing failed', async () => {
    await SocialRecoveryBuilder.from(holder()).withVersionEscape().build();

    expect(setupArgs().versionEscaped).not.toBe(true);
    expect(recoveryArgs().versionEscaped).not.toBe(true);
  });
});

describe('the orchestrator', () => {
  it('receives all four bindings by default', async () => {
    await SocialRecoveryBuilder.from(holder()).build();

    expect(orchestratorArgs().bindings).toEqual([...DEVICE_BINDINGS]);
  });

  it('receives the bindings the inputs name', () => {
    SocialRecoveryBuilder.from({ descriptor: DESCRIPTOR, deviceBindings: ['none', 'external-app'] }).buildMethodsOrchestrator();

    expect(orchestratorArgs().bindings).toEqual(['none', 'external-app']);
  });

  it('builds on an approver builder from the descriptor alone, constructing no chain part', () => {
    SocialRecoveryBuilder.from({ descriptor: DESCRIPTOR }).buildMethodsOrchestrator();

    expect([...orchestratorArgs().methods.keys()].map((key) => getAddress(key))).toEqual([METHOD_ECDSA, METHOD_PASSKEY]);
    expect(orchestratorArgs().codecs.get(ACTION)).toBeDefined();
    expect(of('PolicyManager')).toHaveLength(0);
    expect(of('EventManager')).toHaveLength(0);
    expect(of('AmbireRecoveryAction')).toHaveLength(0);
  });

  it('is constructed once per builder', async () => {
    const builder = SocialRecoveryBuilder.from(holder());

    builder.buildMethodsOrchestrator();
    await builder.build();
    builder.buildMethodsOrchestrator();

    expect(of('MethodsOrchestrator')).toHaveLength(1);
    expect(of('SetupClient')).toHaveLength(1);
    expect(of('RecoveryClient')).toHaveLength(1);
  });
});

describe('the classes the builder hands out', () => {
  it('are the shipped classes', async () => {
    const kit = await SocialRecoveryBuilder.from(holder()).build();

    expect(kit.setupClient).toBeInstanceOf(SetupClient);
    expect(kit.recoveryClient).toBeInstanceOf(RecoveryClient);
    expect(kit.methodsOrchestrator).toBeInstanceOf(MethodsOrchestrator);
    expect(of('PolicyManager')[0]!.instance).toBeInstanceOf(PolicyManager);
    expect(of('EventManager')[0]!.instance).toBeInstanceOf(EventManager);
    expect(of('AmbireRecoveryAction')[0]!.instance).toBeInstanceOf(AmbireRecoveryAction);
  });
});
