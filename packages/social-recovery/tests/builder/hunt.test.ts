import { describe, expect, it } from 'vitest';
import {
  BUILDER_FROZEN_MESSAGE,
  BUILDER_MODULE_CLAIMED_MESSAGE,
  BUILDER_NO_PUBLIC_DEPLOYMENT_MESSAGE,
  BUILDER_PENDING_MESSAGE,
  KitRefusalError,
  SocialRecoveryBuilder,
  isProviderRevert,
  passkeyMethod,
  type ManagerReading,
} from '../../src/index';
import {
  ACCOUNT,
  ChainDouble,
  DESCRIPTOR,
  EXTRA_MODULE,
  SEPOLIA,
  eventsStub,
  signerRecoveryStub,
  MAINNET,
  failureOf,
  goodDomain,
  goodWorld,
  holder,
  methodServing,
  type ChainWorld,
} from './doubles';

/** Whether a first build either succeeds or refuses with the builder's own refusal, never a raw provider value. */
async function settles(world: ChainWorld): Promise<{ readonly built: boolean; readonly thrown?: unknown; readonly reading?: ManagerReading }> {
  const builder = SocialRecoveryBuilder.from(holder(new ChainDouble(world)));

  try {
    await builder.buildSetupClient();

    return { built: true, reading: builder.managerReading()! };
  } catch (thrown) {
    return { built: false, thrown };
  }
}

describe('inputs a naive builder lets through', () => {
  it('never lets a reverting version() escape as a raw revert', async () => {
    const outcome = await settles({ ...goodWorld(), version: { reverts: '0x' } });

    expect(isProviderRevert(outcome.thrown)).toBe(false);

    if (outcome.built) expect(outcome.reading?.versionMismatch).toBe(true);
    else expect(outcome.thrown).toBeInstanceOf(KitRefusalError);
  });

  it('never lets an undecodable version() escape as a decoding error', async () => {
    const outcome = await settles({ ...goodWorld(), version: { undecodable: '0x12' } });

    if (outcome.built) expect(outcome.reading?.versionMismatch).toBe(true);
    else expect(outcome.thrown).toBeInstanceOf(KitRefusalError);
  });

  it('refuses a bitmap naming extensions', async () => {
    const outcome = await settles({ ...goodWorld(), domain: { ...goodDomain(), fields: '0x2f', extensions: [1n] } });

    expect(outcome.thrown).toBeInstanceOf(KitRefusalError);
  });

  it('refuses a bitmap missing the verifying contract', async () => {
    expect((await settles({ ...goodWorld(), domain: { ...goodDomain(), fields: '0x07' } })).thrown).toBeInstanceOf(KitRefusalError);
  });

  it('refuses a domain name differing only in case', async () => {
    expect((await settles({ ...goodWorld(), domain: { ...goodDomain(), name: 'policymanager' } })).thrown).toBeInstanceOf(KitRefusalError);
  });

  it('refuses a domain version that is a prefix of the digest version', async () => {
    expect((await settles({ ...goodWorld(), domain: { ...goodDomain(), version: '1.0' } })).thrown).toBeInstanceOf(KitRefusalError);
  });

  it('lets a passkey implementation registered over the default one replace it', async () => {
    const passkey = passkeyMethod();
    const builder = SocialRecoveryBuilder.from(holder()).withMethod(passkey);

    await builder.buildSetupClient();

    expect(() => builder.buildMethodsOrchestrator()).not.toThrow();
  });

  it('refuses two added passkey implementations over one module', async () => {
    const thrown = await failureOf(() => SocialRecoveryBuilder.from(holder()).withMethod(passkeyMethod()).withMethod(passkeyMethod()).buildSetupClient());

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toContain(BUILDER_MODULE_CLAIMED_MESSAGE);
  });

  it('never turns a method naming one module twice into a RangeError', async () => {
    const thrown = await failureOf(async () => {
      await SocialRecoveryBuilder.from(holder()).withMethod(methodServing([EXTRA_MODULE, EXTRA_MODULE])).build();
      throw new Error('built');
    });

    expect(thrown instanceof TypeError || (thrown as Error).message === 'built').toBe(true);
  });

  it('accepts another builder\'s reading after a structured clone', async () => {
    const first = SocialRecoveryBuilder.from(holder());

    await first.buildSetupClient();

    const clone = structuredClone(first.managerReading()!);
    const provider = new ChainDouble();

    await SocialRecoveryBuilder.from(holder(provider)).withManagerReading(clone).buildSetupClient();

    expect(provider.managerCalls()).toBe(0);
  });

  it('accepts another builder\'s reading naming the manager in lower case', async () => {
    const first = SocialRecoveryBuilder.from(holder());

    await first.buildSetupClient();

    const reading = first.managerReading()!;
    const lower = { ...reading, manager: reading.manager.toLowerCase() } as ManagerReading;
    const provider = new ChainDouble();

    await SocialRecoveryBuilder.from(holder(provider)).withManagerReading(lower).buildSetupClient();

    expect(provider.managerCalls()).toBe(0);
  });

  it('refuses a reading whose domain disagrees with its own chain id', async () => {
    const first = SocialRecoveryBuilder.from(holder());

    await first.buildSetupClient();

    const reading = first.managerReading()!;
    const forged = { ...reading, domain: { ...reading.domain, chainId: MAINNET } } as ManagerReading;

    expect(await failureOf(() => SocialRecoveryBuilder.from(holder()).withManagerReading(forged).buildSetupClient())).toBeInstanceOf(KitRefusalError);
  });

  it('never caches a reading when the version read fails as a transport would', async () => {
    const failure = new Error('timeout');
    const provider = new ChainDouble({ ...goodWorld(), version: { rejects: failure } });
    const builder = SocialRecoveryBuilder.from(holder(provider));

    expect(await failureOf(() => builder.buildSetupClient())).toBe(failure);
    expect(builder.managerReading()).toBeUndefined();

    provider.world = goodWorld();

    await builder.buildSetupClient();

    expect(provider.reads).toEqual(['chainId', 'eip712Domain', 'version', 'chainId', 'eip712Domain', 'version']);
  });

  it('builds one set of parts when two builds race on a fresh builder', async () => {
    const provider = new ChainDouble();
    const builder = SocialRecoveryBuilder.from(holder(provider));
    const [setup, again] = await Promise.all([builder.buildSetupClient(), builder.buildSetupClient()]);

    expect(again).toBe(setup);
    expect(provider.managerCalls()).toBe(2);
  });

  it('keeps a supplied event manager instance that also carries a logChunkSize member', async () => {
    const events = Object.assign(eventsStub(), { logChunkSize: 5 });
    const client = await SocialRecoveryBuilder.from(holder()).withEventManager(events).buildSetupClient();

    expect(client.events).toBe(events);
  });

  it('refuses a setter while the first build is still reading with the pending message, then with the frozen one', async () => {
    const builder = SocialRecoveryBuilder.from(holder());
    const pending = builder.build();
    const messages: string[] = [];

    for (const set of [() => builder.withSignerRecovery(signerRecoveryStub()), () => builder.withVersionEscape()]) {
      try {
        set();
      } catch (thrown) {
        expect(thrown).toBeInstanceOf(TypeError);
        messages.push((thrown as TypeError).message);
      }
    }

    await pending;

    expect(messages).toEqual([BUILDER_PENDING_MESSAGE, BUILDER_PENDING_MESSAGE]);
    expect(() => builder.withVersionEscape()).toThrow(BUILDER_FROZEN_MESSAGE);
    expect(BUILDER_PENDING_MESSAGE).not.toBe(BUILDER_FROZEN_MESSAGE);
  });
});

describe('the orchestrator without a resolved descriptor', () => {
  it('refuses the zero default of an approver named by chain id alone', () => {
    expect(() => SocialRecoveryBuilder.from({ chainId: SEPOLIA }).buildMethodsOrchestrator()).toThrow(BUILDER_NO_PUBLIC_DEPLOYMENT_MESSAGE);
  });

  it('builds for a holder naming a descriptor and refuses one naming no chain with a TypeError', async () => {
    const builder = SocialRecoveryBuilder.from({ provider: new ChainDouble(), account: ACCOUNT, descriptor: DESCRIPTOR });

    expect(() => builder.buildMethodsOrchestrator()).not.toThrow();

    const unnamed = SocialRecoveryBuilder.from({ provider: new ChainDouble(), account: ACCOUNT });

    expect(() => unnamed.buildMethodsOrchestrator()).toThrow(TypeError);
  });
});
