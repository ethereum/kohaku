import { describe, expect, it } from 'vitest';
import { KitRefusalError, SETUP_CLIENT_VERSION_ESCAPED_MESSAGE, SocialRecoveryBuilder, type ISetupClient, type IRecoveryClient } from '../../src/index';
import {
  ACTION,
  ChainDouble,
  METHOD_ECDSA,
  SENTINEL,
  actionStub,
  eventsStub,
  failureOf,
  goodDomain,
  goodWorld,
  holder,
  managerStub,
  type ChainWorld,
  callsOf,
} from './doubles';

const FIELDS_WRONG: ChainWorld = { ...goodWorld(), domain: { ...goodDomain(), fields: '0x1f' } };

/** A builder over stub parts and the given world, with the escape set. */
function escapedRig(world: ChainWorld = FIELDS_WRONG) {
  const manager = managerStub();
  const action = actionStub();
  const events = eventsStub();
  const builder = SocialRecoveryBuilder.from(holder(new ChainDouble(world)))
    .withPolicyManager(manager)
    .withRecoveryAction(ACTION, action)
    .withEventManager(events)
    .withVersionEscape();

  return { builder, manager, action, events };
}

const anything = {} as never;

const SETUP_PREPARES: readonly (readonly [string, (client: ISetupClient) => Promise<unknown>])[] = [
  ['prepareCommitSetup', (client) => client.prepareCommitSetup(anything)],
  ['prepareClearSetup', (client) => client.prepareClearSetup()],
];

const RECOVERY_PREPARES: readonly (readonly [string, (client: IRecoveryClient) => Promise<unknown>])[] = [
  ['prepareStartAttempt', (client) => client.prepareStartAttempt(anything, anything)],
  ['prepareCancelByProofs', (client) => client.prepareCancelByProofs(anything, anything)],
  ['prepareCancelByOwner', (client) => client.prepareCancelByOwner()],
  ['prepareCancelByVeto', (client) => client.prepareCancelByVeto(METHOD_ECDSA)],
  ['prepareExecuteHandover', (client) => client.prepareExecuteHandover(anything, '0x')],
];

const isEscapeRefusal = (thrown: unknown): boolean => thrown instanceof KitRefusalError && thrown.message === SETUP_CLIENT_VERSION_ESCAPED_MESSAGE;

const stubCalls = (...stubs: readonly object[]): number =>
  stubs.reduce((sum, stub) => sum + Object.keys(stub).reduce((count, member) => count + callsOf(stub, member).length, 0), 0);

describe('the version escape', () => {
  it('records every escapable check that failed, in the order the checks run', async () => {
    const { builder } = escapedRig({ ...goodWorld(), domain: { ...goodDomain(), fields: '0x1f', version: '2', name: 'Other' } });

    await builder.buildSetupClient();

    expect(builder.managerReading()?.escaped).toEqual(['fields', 'digest-version', 'domain-name']);
  });

  it.each(SETUP_PREPARES)('refuses the setup client %s', async (_name, run) => {
    const { builder } = escapedRig();

    expect(isEscapeRefusal(await failureOf(async () => run(await builder.buildSetupClient())))).toBe(true);
  });

  it.each(RECOVERY_PREPARES)('refuses the recovery client %s', async (_name, run) => {
    const { builder } = escapedRig();

    expect(isEscapeRefusal(await failureOf(async () => run(await builder.buildRecoveryClient())))).toBe(true);
  });

  it('leaves the setup client reading', async () => {
    const { builder, manager, action, events } = escapedRig();
    const client = await builder.buildSetupClient();
    const thrown = await failureOf(() => client.setupState());

    expect(isEscapeRefusal(thrown)).toBe(false);
    expect(stubCalls(manager, action, events)).toBeGreaterThan(0);
  });

  it('leaves the recovery client reading', async () => {
    const { builder, manager, action, events } = escapedRig();
    const client = await builder.buildRecoveryClient();
    const thrown = await failureOf(() => client.recoveryState());

    expect(isEscapeRefusal(thrown)).toBe(false);
    expect(stubCalls(manager, action, events)).toBeGreaterThan(0);
  });

  it('hands out a frozen action part whose disarming call refuses and whose reads delegate', async () => {
    const { builder, action } = escapedRig();
    const part = await builder.recoveryAction();

    expect(Object.isFrozen(part)).toBe(true);
    expect(await failureOf(() => part.disarmingCall())).toBeInstanceOf(KitRefusalError);
    expect(callsOf(action, 'disarmingCall')).toHaveLength(0);
    expect(await failureOf(() => part.actionInfo())).toBe(SENTINEL);
    expect(await failureOf(() => part.supportsAccount())).toBe(SENTINEL);
    expect(callsOf(action, 'actionInfo')).toHaveLength(1);
    expect('armingCall' in part).toBe(false);
  });

  it('leaves the module views reading', async () => {
    const { builder, manager } = escapedRig();
    const reads = await builder.methodModuleReads();

    expect(await failureOf(() => reads.moduleInfo(METHOD_ECDSA))).toBe(SENTINEL);
    expect(callsOf(manager, 'moduleInfo')).toHaveLength(1);
  });

  it('escapes nothing where no escapable check failed', async () => {
    const { builder, action } = escapedRig(goodWorld());
    const setup = await builder.buildSetupClient();
    const recovery = await builder.buildRecoveryClient();

    expect(builder.managerReading()?.escaped).toEqual([]);

    for (const [, run] of SETUP_PREPARES) expect(isEscapeRefusal(await failureOf(() => run(setup)))).toBe(false);

    for (const [, run] of RECOVERY_PREPARES) expect(isEscapeRefusal(await failureOf(() => run(recovery)))).toBe(false);

    expect(await failureOf(async () => (await builder.recoveryAction()).disarmingCall())).toBe(SENTINEL);
    expect(callsOf(action, 'disarmingCall')).toHaveLength(1);
  });

  it('records a release mismatch beside an escape without escaping for it', async () => {
    const { builder } = escapedRig({ ...goodWorld(), version: '9.9.9' });
    const client = await builder.buildSetupClient();

    expect(builder.managerReading()).toMatchObject({ escaped: [], versionMismatch: true });
    expect(isEscapeRefusal(await failureOf(() => client.prepareClearSetup()))).toBe(false);
  });
});

describe('without the escape', () => {
  it('hands out an action part that reads and disarms', async () => {
    const action = actionStub();
    const builder = SocialRecoveryBuilder.from(holder()).withRecoveryAction(ACTION, action);
    const part = await builder.recoveryAction();

    expect(await failureOf(() => part.disarmingCall())).toBe(SENTINEL);
    expect(await failureOf(() => part.actionInfo())).toBe(SENTINEL);
  });

  it('hands out no arming seam through recoveryAction()', async () => {
    const part = await SocialRecoveryBuilder.from(holder()).recoveryAction();

    expect('armingCall' in part).toBe(false);
  });

  it('hands out the module views without the manager prepares', async () => {
    const reads = await SocialRecoveryBuilder.from(holder()).methodModuleReads();

    expect(typeof reads.moduleInfo).toBe('function');
    expect(typeof reads.paused).toBe('function');
    expect(typeof reads.trustedParties).toBe('function');
    expect('prepareCommitSetup' in reads).toBe(false);
    expect('prepareStartAttempt' in reads).toBe(false);
  });
});
