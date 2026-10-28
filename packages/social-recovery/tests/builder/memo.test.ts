import { beforeAll, describe, expect, it } from 'vitest';
import { KitRefusalError, SocialRecoveryBuilder, walletMethod, type ManagerReading } from '../../src/index';
import {
  ACTION,
  ChainDouble,
  DESCRIPTOR,
  MAINNET,
  METHOD_ECDSA,
  OTHER_ACTION,
  OTHER_MANAGER,
  SENTINEL,
  actionStub,
  codecServing,
  deepFrozen,
  eventsStub,
  failureOf,
  goodDomain,
  goodWorld,
  holder,
  managerStub,
  signerRecoveryStub,
  callsOf,
} from './doubles';

type Builder = ReturnType<typeof SocialRecoveryBuilder.from<ReturnType<typeof holder>>>;

const BUILDS: readonly (readonly [string, (builder: Builder) => Promise<unknown> | unknown])[] = [
  ['buildSetupClient', (builder) => builder.buildSetupClient()],
  ['buildRecoveryClient', (builder) => builder.buildRecoveryClient()],
  ['buildMethodsOrchestrator', (builder) => builder.buildMethodsOrchestrator()],
  ['recoveryAction', (builder) => builder.recoveryAction()],
  ['methodModuleReads', (builder) => builder.methodModuleReads()],
  ['build', (builder) => builder.build()],
];

const CHECKED_BUILDS = BUILDS.filter(([name]) => name !== 'buildMethodsOrchestrator');

let READING: ManagerReading;

beforeAll(async () => {
  READING = await readingOf();
});

/** Every setter, called once with a well-formed value. */
const SETTERS: readonly (readonly [string, (builder: Builder) => unknown])[] = [
  ['withPolicyManager', (builder) => builder.withPolicyManager(managerStub())],
  ['withEventManager instance', (builder) => builder.withEventManager(eventsStub())],
  ['withEventManager options', (builder) => builder.withEventManager({ logChunkSize: 500 })],
  ['withRecoveryAction', (builder) => builder.withRecoveryAction(ACTION)],
  ['withCodec instance', (builder) => builder.withCodec(codecServing(OTHER_ACTION))],
  ['withCodec options', (builder) => builder.withCodec({ actions: [OTHER_ACTION] })],
  ['withMethod', (builder) => builder.withMethod(walletMethod())],
  ['withSignerRecovery', (builder) => builder.withSignerRecovery(signerRecoveryStub())],
  ['withVersionEscape', (builder) => builder.withVersionEscape()],
  ['withManagerReading', (builder) => builder.withManagerReading(READING)],
];

/** A reading taken by a first builder over a good world. */
async function readingOf(world = goodWorld(), escape = false): Promise<ManagerReading> {
  const builder = SocialRecoveryBuilder.from(holder(new ChainDouble(world)));

  if (escape) builder.withVersionEscape();

  await builder.buildSetupClient();

  return builder.managerReading()!;
}

describe('memoization', () => {
  it.each(BUILDS)('%s twice hands back the same instance', async (_name, run) => {
    const builder = SocialRecoveryBuilder.from(holder());
    const first = await run(builder);
    const second = await run(builder);

    if (_name === 'build') {
      const [a, b] = [first as Record<string, unknown>, second as Record<string, unknown>];

      expect(b['setupClient']).toBe(a['setupClient']);
      expect(b['recoveryClient']).toBe(a['recoveryClient']);
      expect(b['methodsOrchestrator']).toBe(a['methodsOrchestrator']);
    } else {
      expect(second).toBe(first);
    }
  });

  it('hands out the named builds\' instances in the bundle, the bundle first', async () => {
    const builder = SocialRecoveryBuilder.from(holder());
    const kit = await builder.build();

    expect(await builder.buildSetupClient()).toBe(kit.setupClient);
    expect(await builder.buildRecoveryClient()).toBe(kit.recoveryClient);
    expect(builder.buildMethodsOrchestrator()).toBe(kit.methodsOrchestrator);
    expect(Object.isFrozen(kit)).toBe(true);
  });

  it('hands out the named builds\' instances in the bundle, the named builds first', async () => {
    const builder = SocialRecoveryBuilder.from(holder());
    const setupClient = await builder.buildSetupClient();
    const methodsOrchestrator = builder.buildMethodsOrchestrator();
    const recoveryClient = await builder.buildRecoveryClient();

    const kit = await builder.build();

    expect(kit.setupClient).toBe(setupClient);
    expect(kit.recoveryClient).toBe(recoveryClient);
    expect(kit.methodsOrchestrator).toBe(methodsOrchestrator);
  });

  it.each(CHECKED_BUILDS)('runs the sequence on %s as the first build and never again on the builder', async (_name, run) => {
    const provider = new ChainDouble();
    const builder = SocialRecoveryBuilder.from(holder(provider));

    await run(builder);

    expect(provider.reads).toEqual(['chainId', 'eip712Domain', 'version']);

    for (const [, other] of BUILDS) await other(builder);

    expect(provider.reads).toEqual(['chainId', 'eip712Domain', 'version']);
  });

  it('runs nothing on chain for the orchestrator', () => {
    const provider = new ChainDouble();

    SocialRecoveryBuilder.from(holder(provider)).buildMethodsOrchestrator();

    expect(provider.reads).toEqual([]);
  });

  it('reads again on a fresh builder and on each static build', async () => {
    const provider = new ChainDouble();
    const first = await SocialRecoveryBuilder.from(holder(provider)).buildSetupClient();
    const second = await SocialRecoveryBuilder.from(holder(provider)).buildSetupClient();

    expect(second).not.toBe(first);
    expect(provider.managerCalls()).toBe(4);

    const kitA = await SocialRecoveryBuilder.build(holder(provider));
    const kitB = await SocialRecoveryBuilder.build(holder(provider));

    expect(kitB.setupClient).not.toBe(kitA.setupClient);
    expect(provider.managerCalls()).toBe(8);
  });

  it('hands out the same event manager on both clients', async () => {
    const kit = await SocialRecoveryBuilder.build(holder());

    expect(kit.recoveryClient.events).toBe(kit.setupClient.events);
  });
});

describe('the freeze', () => {
  it.each(BUILDS)('refuses every setter with a TypeError after a successful %s', async (_name, run) => {
    for (const [, set] of SETTERS) {
      const builder = SocialRecoveryBuilder.from(holder());

      await run(builder);

      expect(() => set(builder)).toThrow(TypeError);
    }
  });

  it('leaves the setters open after a refused build and reads again on the retry', async () => {
    const provider = new ChainDouble({ ...goodWorld(), domain: { ...goodDomain(), fields: '0x1f' } });
    const builder = SocialRecoveryBuilder.from(holder(provider));

    expect(await failureOf(() => builder.buildSetupClient())).toBeInstanceOf(KitRefusalError);
    expect(builder.managerReading()).toBeUndefined();

    builder.withVersionEscape();

    await builder.buildSetupClient();

    expect(provider.reads).toEqual(['chainId', 'eip712Domain', 'chainId', 'eip712Domain', 'version']);
  });

  it('leaves the setters open after a transport failure and builds on the retry', async () => {
    const failure = new Error('connect ECONNREFUSED');
    const provider = new ChainDouble({ ...goodWorld(), chainId: { rejects: failure } });
    const builder = SocialRecoveryBuilder.from(holder(provider));

    expect(await failureOf(() => builder.build())).toBe(failure);

    provider.world = goodWorld();
    builder.withSignerRecovery(signerRecoveryStub());

    await expect(builder.build()).resolves.toBeDefined();
    expect(provider.reads).toEqual(['chainId', 'chainId', 'eip712Domain', 'version']);
  });

  it('leaves the setters open after a refused recoveryAction() and methodModuleReads()', async () => {
    for (const run of [(builder: Builder) => builder.recoveryAction(), (builder: Builder) => builder.methodModuleReads()]) {
      const builder = SocialRecoveryBuilder.from(holder(new ChainDouble({ ...goodWorld(), chainId: MAINNET })));

      expect(await failureOf(() => run(builder))).toBeInstanceOf(KitRefusalError);
      expect(() => builder.withVersionEscape()).not.toThrow();
    }
  });
});

describe('setter repeats before a build', () => {
  it('returns the builder itself from every setter', () => {
    for (const [, set] of SETTERS) {
      const builder = SocialRecoveryBuilder.from(holder());

      expect(set(builder)).toBe(builder);
    }
  });

  it('replaces the policy manager', async () => {
    const [first, second] = [managerStub(), managerStub()];
    const reads = await SocialRecoveryBuilder.from(holder()).withPolicyManager(first).withPolicyManager(second).methodModuleReads();

    expect(await failureOf(() => reads.paused(METHOD_ECDSA))).toBe(SENTINEL);
    expect(callsOf(second, 'paused')).toHaveLength(1);
    expect(callsOf(first, 'paused')).toHaveLength(0);
  });

  it('replaces the event manager', async () => {
    const [first, second] = [eventsStub(), eventsStub()];
    const kit = await SocialRecoveryBuilder.from(holder()).withEventManager(first).withEventManager(second).build();

    expect(kit.setupClient.events).toBe(second);
    expect(kit.recoveryClient.events).toBe(second);
  });

  it('replaces an event manager instance with options and the other way round', async () => {
    const instance = eventsStub();
    const replaced = await SocialRecoveryBuilder.from(holder()).withEventManager(instance).withEventManager({ logChunkSize: 5 }).buildSetupClient();

    expect(replaced.events).not.toBe(instance);

    const kept = await SocialRecoveryBuilder.from(holder()).withEventManager({ logChunkSize: 5 }).withEventManager(instance).buildSetupClient();

    expect(kept.events).toBe(instance);
  });

  it('replaces the recovery action', async () => {
    const [first, second] = [actionStub(), actionStub()];
    const part = await SocialRecoveryBuilder.from(holder()).withRecoveryAction(ACTION, first).withRecoveryAction(OTHER_ACTION, second).recoveryAction();

    await failureOf(() => part.actionInfo());

    expect(callsOf(second, 'actionInfo')).toHaveLength(1);
    expect(callsOf(first, 'actionInfo')).toHaveLength(0);
  });

  it('adds methods: a claim on a default module replaces the default, two added claims on one module refuse at the first build', async () => {
    await expect(SocialRecoveryBuilder.from(holder()).withMethod(walletMethod()).buildSetupClient()).resolves.toBeDefined();

    const builder = SocialRecoveryBuilder.from(holder()).withMethod(walletMethod()).withMethod(walletMethod());

    expect(await failureOf(() => builder.buildSetupClient())).toBeInstanceOf(TypeError);
    expect(() => builder.withVersionEscape()).not.toThrow();
  });
});

describe('the cached reading', () => {
  it('is undefined before a build', () => {
    expect(SocialRecoveryBuilder.from(holder()).managerReading()).toBeUndefined();
  });

  it('is undefined after the orchestrator build alone', () => {
    const builder = SocialRecoveryBuilder.from(holder());

    builder.buildMethodsOrchestrator();

    expect(builder.managerReading()).toBeUndefined();
  });

  it('carries the chain, the manager, the domain, the release and the judgement, deep-frozen', async () => {
    const reading = await readingOf();

    expect(reading).toEqual({
      chainId: DESCRIPTOR.chainId,
      manager: DESCRIPTOR.manager,
      domain: { ...goodDomain(), extensions: [] },
      version: '1.0.0',
      escaped: [],
      versionMismatch: false,
    });
    expect(deepFrozen(reading)).toBe(true);
  });

  it('serves a second builder with no manager call', async () => {
    const reading = await readingOf();
    const provider = new ChainDouble();
    const builder = SocialRecoveryBuilder.from(holder(provider)).withManagerReading(reading);

    await builder.build();

    expect(provider.reads).toEqual(['chainId']);
    expect(builder.managerReading()).toEqual(reading);
  });

  it('still runs the chain id check on the second builder', async () => {
    const reading = await readingOf();
    const provider = new ChainDouble({ ...goodWorld(), chainId: MAINNET });

    expect(await failureOf(() => SocialRecoveryBuilder.from(holder(provider)).withManagerReading(reading).buildSetupClient())).toBeInstanceOf(
      KitRefusalError,
    );
    expect(provider.managerCalls()).toBe(0);
  });

  it('is judged against the second builder\'s own escape option', async () => {
    const reading = await readingOf({ ...goodWorld(), domain: { ...goodDomain(), fields: '0x1f' } }, true);

    expect(reading.escaped).toEqual(['fields']);

    const strict = new ChainDouble();

    expect(await failureOf(() => SocialRecoveryBuilder.from(holder(strict)).withManagerReading(reading).buildSetupClient())).toBeInstanceOf(
      KitRefusalError,
    );
    expect(strict.managerCalls()).toBe(0);

    const lenient = SocialRecoveryBuilder.from(holder()).withManagerReading(reading).withVersionEscape();

    await lenient.buildSetupClient();

    expect(lenient.managerReading()?.escaped).toEqual(['fields']);
  });

  it('refuses a reading of another manager or another chain', async () => {
    const reading = await readingOf();

    for (const other of [
      { ...reading, manager: OTHER_MANAGER },
      { ...reading, chainId: MAINNET },
    ]) {
      const thrown = await failureOf(() => SocialRecoveryBuilder.from(holder()).withManagerReading(other).buildSetupClient());

      expect(thrown).toBeInstanceOf(KitRefusalError);
    }
  });

  it('refuses a reading that is no reading with a TypeError at the call', () => {
    for (const malformed of [undefined, null, {}, { chainId: 1 }]) {
      expect(() => SocialRecoveryBuilder.from(holder()).withManagerReading(malformed as unknown as ManagerReading)).toThrow(TypeError);
    }
  });
});
