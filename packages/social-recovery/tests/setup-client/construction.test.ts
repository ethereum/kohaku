import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KitRefusalError, SetupClient, type ISetupClient, type RestoreCause } from '../../src/index';
import { PACKAGE_ROOT } from '../helpers/source';
import {
  ACCOUNT,
  ACCOUNT_BAD_CHECKSUM,
  ACTION,
  build,
  codecFor,
  CONFIGURATION,
  defaultRegistry,
  DESCRIPTOR,
  doubles,
  defaultWorld,
  DRAFT,
  noSetupState,
  OTHER_ACTION,
} from './doubles';

const MEMBERS = [
  'validateSetup',
  'describeSetup',
  'prepareCommitSetup',
  'prepareClearSetup',
  'confirmSetup',
  'setupState',
  'getSetup',
] as const;

/** The built core entry, which `pnpm build` must have produced before the run. */
const loadBuilt = async (): Promise<Record<string, unknown>> =>
  (await import(pathToFileURL(join(PACKAGE_ROOT, 'dist', 'index.js')).href)) as Record<string, unknown>;

/** The value a construction or a first call throws, building the client under the given account. */
async function refusalUnder(account: string): Promise<{ thrown: unknown; providerCalls: number }> {
  const made = doubles(defaultWorld());

  try {
    const client = new SetupClient(
      made.provider,
      DESCRIPTOR,
      account as `0x${string}`,
      ACTION,
      CONFIGURATION,
      made.manager,
      made.action,
      made.events,
      defaultRegistry(),
      codecFor(ACTION),
    );

    await client.setupState();

    return { thrown: undefined, providerCalls: made.seen.provider.length };
  } catch (thrown) {
    return { thrown, providerCalls: made.seen.provider.length };
  }
}

describe('SetupClient construction', () => {
  it('implements every member of ISetupClient', () => {
    const { client } = build();
    const typed: ISetupClient = client;

    for (const member of MEMBERS) expect(typeof typed[member]).toBe('function');
  });

  it('exposes the injected event manager as events', () => {
    const { client, events } = build();

    expect(client.events).toBe(events);
  });

  it('constructs nothing and calls nothing while being built', () => {
    const { seen } = build();

    expect(seen.provider).toEqual([]);
    expect(seen.parts).toEqual([]);
    expect(seen.filterOptions).toEqual([]);
  });

  it('is exported from the built entry as a class', async () => {
    expect(typeof (await loadBuilt())['SetupClient']).toBe('function');
  });

  it('refuses a mixed-case account whose checksum fails before any provider call', async () => {
    const { thrown, providerCalls } = await refusalUnder(ACCOUNT_BAD_CHECKSUM);

    expect(thrown).toBeInstanceOf(TypeError);
    expect(providerCalls).toBe(0);
  });

  it('refuses a malformed action before any provider call', async () => {
    const made = doubles(defaultWorld());

    expect(
      () =>
        new SetupClient(
          made.provider,
          DESCRIPTOR,
          ACCOUNT,
          '0x1234',
          CONFIGURATION,
          made.manager,
          made.action,
          made.events,
          defaultRegistry(),
          codecFor(ACTION),
        ),
    ).toThrow();
    expect(made.seen.provider).toEqual([]);
  });

  it('refuses a construction without the codec', () => {
    const made = doubles(defaultWorld());
    const construct = SetupClient as unknown as new (...args: unknown[]) => SetupClient;

    expect(
      () =>
        new construct(made.provider, DESCRIPTOR, ACCOUNT, ACTION, CONFIGURATION, made.manager, made.action, made.events, defaultRegistry()),
    ).toThrow(TypeError);
  });

  it('refuses a codec that does not serve the bound action', () => {
    const made = doubles(defaultWorld());

    expect(
      () =>
        new SetupClient(
          made.provider,
          DESCRIPTOR,
          ACCOUNT,
          ACTION,
          CONFIGURATION,
          made.manager,
          made.action,
          made.events,
          defaultRegistry(),
          codecFor(OTHER_ACTION),
        ),
    ).toThrow();
    expect(made.seen.provider).toEqual([]);
  });

  it.each([
    ['all lower case', ACCOUNT.toLowerCase()],
    ['all upper case', `0x${ACCOUNT.slice(2).toUpperCase()}`],
  ])('accepts an account spelled %s and names it checksummed', async (_name, spelling) => {
    const { client } = build({ account: spelling as `0x${string}`, world: { state: noSetupState() } });
    const thrown = await client.getSetup({ password: 'pw' }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(((thrown as KitRefusalError).restoreCause as RestoreCause).values).toMatchObject({ account: ACCOUNT });
  });

  it('refuses a malformed draft with a TypeError before any provider call', async () => {
    const { client, seen } = build();

    await expect(client.validateSetup({ ...DRAFT, clauses: 'none' } as never)).rejects.toThrow(TypeError);
    expect(seen.provider).toEqual([]);
  });

  it('refuses malformed prepare options before any provider call', async () => {
    const { client, seen } = build();

    await expect(client.prepareClearSetup({ simulate: 'yes' } as never)).rejects.toThrow(TypeError);
    expect(seen.provider).toEqual([]);
  });
});
