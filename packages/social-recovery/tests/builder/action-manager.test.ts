import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { BUILDER_ACTION_MANAGER_MESSAGE, KitRefusalError, SocialRecoveryBuilder, type DeploymentDescriptor, type Hex, type ManagerReading } from '../../src/index';
import {
  ACTION,
  ACTION_MANAGER_SELECTOR,
  ChainDouble,
  DESCRIPTOR,
  MANAGER,
  OTHER_ACTION,
  OTHER_MANAGER,
  ZERO,
  addressWord,
  builderMessages,
  failureOf,
  goodDomain,
  goodWorld,
  holder,
  type ActionManagerAnswer,
  type ChainWorld,
} from './doubles';

type Builder = ReturnType<typeof SocialRecoveryBuilder.from<ReturnType<typeof holder>>>;

/** Every read a passing build makes, the action's `MANAGER()` last. */
const EVERY_READ = ['chainId', 'eip712Domain', 'version', 'MANAGER'];

/** A good world whose actions answer `MANAGER()` as given. */
const pairedWith = (actionManager: ChainWorld['actionManager']): ChainWorld => ({ ...goodWorld(), actionManager });

/** The builds that hand out a client or part bound to the action. */
const BUILDS: readonly (readonly [string, (builder: Builder) => Promise<unknown>])[] = [
  ['buildSetupClient', (builder) => builder.buildSetupClient()],
  ['buildRecoveryClient', (builder) => builder.buildRecoveryClient()],
  ['recoveryAction', (builder) => builder.recoveryAction()],
  ['build', (builder) => builder.build()],
];

/** Answers that name no manager; the bytes ones carry another manager's address, so only a strict decoder lets them build. */
const UNANSWERED: readonly (readonly [string, ActionManagerAnswer])[] = [
  ['a revert without data', { reverts: '0x' }],
  ['a revert carrying an error', { reverts: '0x08c379a0' }],
  ['no bytes, as an address without code', { undecodable: '0x' }],
  ['a short word', { undecodable: addressWord(OTHER_MANAGER).slice(0, 64) as Hex }],
  ['a word with dirty top bytes', { undecodable: `0x${'ff'.repeat(12)}${OTHER_MANAGER.slice(2).toLowerCase()}` }],
  ['one trailing byte after the word', { undecodable: `${addressWord(OTHER_MANAGER)}00` }],
  ['a second word after the first', { undecodable: `${addressWord(OTHER_MANAGER)}${'00'.repeat(32)}` }],
];

/** Another builder's reading of the good world. */
async function goodReading(): Promise<ManagerReading> {
  const builder = SocialRecoveryBuilder.from(holder());

  await builder.buildSetupClient();

  return builder.managerReading()!;
}

describe("the bound action's MANAGER() read at construction", () => {
  it("reads MANAGER() once from the descriptor's action, from the zero address at the read tag, after version()", async () => {
    const provider = new ChainDouble();

    await SocialRecoveryBuilder.from(holder(provider)).buildSetupClient();

    expect(provider.reads).toEqual(EVERY_READ);
    expect(provider.callsTo(ACTION_MANAGER_SELECTOR)).toEqual([{ to: ACTION, data: ACTION_MANAGER_SELECTOR, from: ZERO, block: 'latest' }]);
  });

  it('reads it at the configured read tag', async () => {
    const provider = new ChainDouble();

    await SocialRecoveryBuilder.from({ ...holder(provider), configuration: { blockTags: { read: 'finalized', watch: 'finalized' } } } as const).buildSetupClient();

    expect(provider.callsTo(ACTION_MANAGER_SELECTOR).map((call) => call.block)).toEqual(['finalized']);
  });

  it("reads the action withRecoveryAction binds, not the descriptor's", async () => {
    const world = pairedWith((action) => (action === OTHER_ACTION ? MANAGER : OTHER_MANAGER));
    const provider = new ChainDouble(world);

    await expect(SocialRecoveryBuilder.from(holder(provider)).withRecoveryAction(OTHER_ACTION).buildSetupClient()).resolves.toBeDefined();
    expect(provider.callsTo(ACTION_MANAGER_SELECTOR).map((call) => getAddress(call.to))).toEqual([OTHER_ACTION]);

    const unbound = await failureOf(() => SocialRecoveryBuilder.from(holder(new ChainDouble(world))).buildSetupClient());

    expect((unbound as Error).message).toBe(BUILDER_ACTION_MANAGER_MESSAGE);
  });

  it('still reads the action under a handed manager reading, which stands in for the manager reads alone', async () => {
    const reading = await goodReading();
    const provider = new ChainDouble();

    await SocialRecoveryBuilder.from(holder(provider)).withManagerReading(reading).buildSetupClient();

    expect(provider.reads).toEqual(['chainId', 'MANAGER']);
  });

  it("builds where the descriptor spells the action's manager in lower or upper case", async () => {
    for (const manager of [MANAGER.toLowerCase(), `0x${MANAGER.slice(2).toUpperCase()}`]) {
      const descriptor = { ...DESCRIPTOR, manager } as DeploymentDescriptor;
      const provider = new ChainDouble(pairedWith(MANAGER));

      await expect(SocialRecoveryBuilder.from(holder(provider, descriptor)).buildSetupClient()).resolves.toBeDefined();
      expect(provider.reads).toEqual(EVERY_READ);
    }
  });
});

describe('a bound action naming another manager', () => {
  it.each(BUILDS)('refuses %s with its own refusal, with and without the version escape', async (_name, run) => {
    for (const escape of [false, true]) {
      const provider = new ChainDouble(pairedWith(OTHER_MANAGER));
      const builder = SocialRecoveryBuilder.from(holder(provider));

      if (escape) builder.withVersionEscape();

      const thrown = await failureOf(() => run(builder));

      expect(thrown).toBeInstanceOf(KitRefusalError);
      expect((thrown as Error).message).toBe(BUILDER_ACTION_MANAGER_MESSAGE);
      expect(provider.reads).toEqual(EVERY_READ);
      expect(builder.managerReading()).toBeUndefined();
    }
  });

  it('refuses the static build', async () => {
    const thrown = await failureOf(() => SocialRecoveryBuilder.build(holder(new ChainDouble(pairedWith(OTHER_MANAGER)))));

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect((thrown as Error).message).toBe(BUILDER_ACTION_MANAGER_MESSAGE);
  });

  it('refuses under the escape where the escape lets a domain check through', async () => {
    const world: ChainWorld = { ...pairedWith(OTHER_MANAGER), domain: { ...goodDomain(), fields: '0x1f', salt: `0x${'ab'.repeat(32)}` } };
    const thrown = await failureOf(() => SocialRecoveryBuilder.from(holder(new ChainDouble(world))).withVersionEscape().buildSetupClient());

    expect((thrown as Error).message).toBe(BUILDER_ACTION_MANAGER_MESSAGE);
  });

  it('refuses under a handed manager reading', async () => {
    const reading = await goodReading();
    const provider = new ChainDouble(pairedWith(OTHER_MANAGER));
    const thrown = await failureOf(() => SocialRecoveryBuilder.from(holder(provider)).withManagerReading(reading).buildSetupClient());

    expect((thrown as Error).message).toBe(BUILDER_ACTION_MANAGER_MESSAGE);
    expect(provider.reads).toEqual(['chainId', 'MANAGER']);
  });

  it('refuses an audited action bound to another manager than the one the setup would commit to', async () => {
    expect(DESCRIPTOR.auditedActions).toContain(ACTION);

    const thrown = await failureOf(() => SocialRecoveryBuilder.from(holder(new ChainDouble(pairedWith(OTHER_MANAGER)))).buildSetupClient());

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect((thrown as Error).message).toBe(BUILDER_ACTION_MANAGER_MESSAGE);
  });

  it('carries a builder message of its own', () => {
    expect(BUILDER_ACTION_MANAGER_MESSAGE).toBe("the recovery action answers MANAGER() with another manager than the descriptor's");
    expect(builderMessages().filter((message) => message === BUILDER_ACTION_MANAGER_MESSAGE)).toHaveLength(1);
  });

  it('caches nothing: the setters reopen and the next build reads again', async () => {
    const provider = new ChainDouble(pairedWith(OTHER_MANAGER));
    const builder = SocialRecoveryBuilder.from(holder(provider));

    expect(await failureOf(() => builder.buildSetupClient())).toBeInstanceOf(KitRefusalError);
    expect(builder.managerReading()).toBeUndefined();
    expect(builder.withVersionEscape()).toBe(builder);

    provider.world = goodWorld();

    await expect(builder.buildSetupClient()).resolves.toBeDefined();
    expect(provider.reads).toEqual([...EVERY_READ, ...EVERY_READ]);
    expect(builder.managerReading()).toBeDefined();
  });
});

describe('a bound action whose MANAGER() answers nothing', () => {
  it.each(UNANSWERED)('builds where the action answers %s', async (_name, answer) => {
    const provider = new ChainDouble(pairedWith(answer));
    const builder = SocialRecoveryBuilder.from(holder(provider));

    await expect(builder.buildSetupClient()).resolves.toBeDefined();
    expect(provider.reads).toEqual(EVERY_READ);
    expect(builder.managerReading()).toMatchObject({ escaped: [], versionMismatch: false });
  });

  it('rejects with a rejection that is no revert as itself, caching nothing', async () => {
    const failure = new Error('connect ECONNREFUSED');
    const provider = new ChainDouble(pairedWith({ rejects: failure }));
    const builder = SocialRecoveryBuilder.from(holder(provider));

    expect(await failureOf(() => builder.buildSetupClient())).toBe(failure);
    expect(builder.managerReading()).toBeUndefined();
  });
});
