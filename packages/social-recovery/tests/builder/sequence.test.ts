import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { BUILDER_BODY_ENCODER_MESSAGE, KitRefusalError, SocialRecoveryBuilder, type DeploymentDescriptor, type Domain } from '../../src/index';
import { escapedChecks } from '../../src/builder/sequence';
import {
  ACCOUNT,
  ChainDouble,
  DESCRIPTOR,
  MANAGER,
  OTHER_MANAGER,
  builderMessages,
  failureOf,
  goodDomain,
  goodWorld,
  holder,
  type ChainWorld,
} from './doubles';

/** A world with the domain answer changed in the given members. */
const domainWith = (change: Partial<ReturnType<typeof goodDomain>>): ChainWorld => ({ ...goodWorld(), domain: { ...goodDomain(), ...change } });

/** The refusal of a first client build over the world, with the double that answered it. */
async function refusalIn(world: ChainWorld, escape = false): Promise<{ readonly thrown: unknown; readonly provider: ChainDouble }> {
  const provider = new ChainDouble(world);
  const builder = SocialRecoveryBuilder.from(holder(provider));

  if (escape) builder.withVersionEscape();

  return { thrown: await failureOf(() => builder.buildSetupClient()), provider };
}

const WRONG: readonly (readonly [string, ChainWorld, readonly string[]])[] = [
  ['the provider answers another chain id', { ...goodWorld(), chainId: 5 }, ['chainId']],
  ['eip712Domain reverts', { ...goodWorld(), domain: { reverts: '0x' } }, ['chainId', 'eip712Domain']],
  ['eip712Domain answers bytes that do not decode', { ...goodWorld(), domain: { undecodable: '0x1234' } }, ['chainId', 'eip712Domain']],
  ['the domain carries another chain id', domainWith({ chainId: 5 }), ['chainId', 'eip712Domain']],
  ['the domain verifies under another contract', domainWith({ verifyingContract: OTHER_MANAGER }), ['chainId', 'eip712Domain']],
];

const ESCAPABLE: readonly (readonly [string, ChainWorld, string])[] = [
  ['the fields bitmap also names a salt', domainWith({ fields: '0x1f', salt: `0x${'ab'.repeat(32)}` }), 'fields'],
  ['the fields bitmap names only the name and version', domainWith({ fields: '0x03' }), 'fields'],
  ['the domain version is 2', domainWith({ version: '2' }), 'digest-version'],
  ['the domain name is PolicyManagerV2', domainWith({ name: 'PolicyManagerV2' }), 'domain-name'],
];

describe('the construction sequence', () => {
  it('reads the chain id once, then eip712Domain and version from the manager at the read tag, and nothing else', async () => {
    const provider = new ChainDouble();

    await SocialRecoveryBuilder.from(holder(provider)).buildSetupClient();

    expect(provider.reads).toEqual(['chainId', 'eip712Domain', 'version']);
    expect(provider.calls.map((call) => getAddress(call.to))).toEqual([MANAGER, MANAGER]);
    expect(ChainDouble.isView(provider.calls[0]!, 'eip712Domain')).toBe(true);
    expect(ChainDouble.isView(provider.calls[1]!, 'version')).toBe(true);
    expect(provider.calls.map((call) => call.block)).toEqual(['latest', 'latest']);
  });

  it('reads at the configured read tag', async () => {
    const provider = new ChainDouble();

    await SocialRecoveryBuilder.from({ ...holder(provider), configuration: { blockTags: { read: 'finalized', watch: 'finalized' } } } as const).buildSetupClient();

    expect(provider.calls.map((call) => call.block)).toEqual(['finalized', 'finalized']);
  });

  it.each(WRONG)('refuses always when %s, reading nothing after the refusal', async (_name, world, reads) => {
    for (const escape of [false, true]) {
      const { thrown, provider } = await refusalIn(world, escape);

      expect(thrown).toBeInstanceOf(KitRefusalError);
      expect(builderMessages()).toContain((thrown as Error).message);
      expect(provider.reads).toEqual(reads);
    }
  });

  it.each(ESCAPABLE)('refuses without the escape when %s, before version() is read', async (_name, world) => {
    const { thrown, provider } = await refusalIn(world);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(builderMessages()).toContain((thrown as Error).message);
    expect(provider.reads).toEqual(['chainId', 'eip712Domain']);
  });

  it.each(ESCAPABLE)('builds under the escape when %s and records the check', async (_name, world, check) => {
    const builder = SocialRecoveryBuilder.from(holder(new ChainDouble(world))).withVersionEscape();

    await builder.buildSetupClient();

    expect(builder.managerReading()?.escaped).toEqual([check]);
  });

  it('refuses a domain version matching the descriptor but not the version this build derives under', async () => {
    const descriptor: DeploymentDescriptor = { ...DESCRIPTOR, digestVersion: '2' };
    const thrown = await failureOf(() => SocialRecoveryBuilder.from(holder(new ChainDouble(goodWorld(descriptor)), descriptor)).buildSetupClient());

    expect(thrown).toBeInstanceOf(KitRefusalError);

    const escaped = SocialRecoveryBuilder.from(holder(new ChainDouble(goodWorld(descriptor)), descriptor)).withVersionEscape();

    await escaped.buildSetupClient();

    expect(escaped.managerReading()?.escaped).toEqual(['digest-version']);
  });

  it('gives every check its own message', async () => {
    const messages = await Promise.all(
      [WRONG[0]![1], WRONG[1]![1], ESCAPABLE[0]![1], ESCAPABLE[2]![1]].map(async (world) => ((await refusalIn(world)).thrown as Error).message),
    );

    expect(new Set(messages).size).toBe(4);
  });

  it('refuses with the earlier check where two checks fail', async () => {
    const both = await refusalIn({ ...domainWith({ fields: '0x1f', name: 'Other' }), chainId: 5 });
    const chainOnly = await refusalIn(WRONG[0]![1]);

    expect((both.thrown as Error).message).toBe((chainOnly.thrown as Error).message);

    const fieldsAndName = await refusalIn(domainWith({ fields: '0x1f', name: 'Other' }));
    const fieldsOnly = await refusalIn(ESCAPABLE[0]![1]);

    expect((fieldsAndName.thrown as Error).message).toBe((fieldsOnly.thrown as Error).message);
  });

  it('passes the body-encoder check while the shipped key is empty', async () => {
    const builder = SocialRecoveryBuilder.from(holder()).withVersionEscape();

    await builder.buildSetupClient();

    expect(builder.managerReading()?.escaped).toEqual([]);
  });

  it('records a manager release differing from the descriptor and still builds', async () => {
    const provider = new ChainDouble({ ...goodWorld(), version: '2.0.0' });
    const builder = SocialRecoveryBuilder.from(holder(provider));

    await expect(builder.buildSetupClient()).resolves.toBeDefined();
    expect(builder.managerReading()).toMatchObject({ version: '2.0.0', versionMismatch: true, escaped: [] });
  });

  it('records no mismatch where the release agrees', async () => {
    const builder = SocialRecoveryBuilder.from(holder());

    await builder.buildSetupClient();

    expect(builder.managerReading()).toMatchObject({ version: '1.0.0', versionMismatch: false, escaped: [] });
  });

  it('accepts a descriptor naming the manager in lower or upper case', async () => {
    for (const manager of [MANAGER.toLowerCase(), `0x${MANAGER.slice(2).toUpperCase()}`]) {
      const descriptor = { ...DESCRIPTOR, manager } as DeploymentDescriptor;

      await expect(SocialRecoveryBuilder.from(holder(new ChainDouble(goodWorld(DESCRIPTOR)), descriptor)).buildSetupClient()).resolves.toBeDefined();
    }
  });

  it('accepts the account in lower case and hands it out checksummed', async () => {
    const builder = SocialRecoveryBuilder.from({ ...holder(), account: ACCOUNT.toLowerCase() as typeof ACCOUNT });

    await expect(builder.buildSetupClient()).resolves.toBeDefined();
  });
});

describe('transport failures', () => {
  const failure = new Error('connect ECONNREFUSED');

  it.each([
    ['the chain id read', { ...goodWorld(), chainId: { rejects: failure } }],
    ['the eip712Domain read', { ...goodWorld(), domain: { rejects: failure } }],
    ['the version read', { ...goodWorld(), version: { rejects: failure } }],
  ] as const)('propagate as themselves from %s', async (_name, world) => {
    expect((await refusalIn(world)).thrown).toBe(failure);
  });
});

describe('the body-encoder check with a listed key', () => {
  const domain = goodDomain() as unknown as Domain;

  it('passes a manager the key lists, whatever its spelling', () => {
    expect(escapedChecks(domain, DESCRIPTOR, false, [OTHER_MANAGER, MANAGER])).toEqual([]);
    expect(escapedChecks(domain, DESCRIPTOR, false, [MANAGER.toLowerCase() as typeof MANAGER])).toEqual([]);
  });

  it('refuses a manager the key does not list unless escaped', () => {
    expect(() => escapedChecks(domain, DESCRIPTOR, false, [OTHER_MANAGER])).toThrow(BUILDER_BODY_ENCODER_MESSAGE);
    expect(escapedChecks(domain, DESCRIPTOR, true, [OTHER_MANAGER])).toEqual(['body-encoder']);
  });

  it('passes every manager while the key is empty', () => {
    expect(escapedChecks(domain, DESCRIPTOR, false, [])).toEqual([]);
  });
});
