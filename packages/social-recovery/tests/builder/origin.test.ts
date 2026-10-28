import { describe, expect, it } from 'vitest';
import {
  BUILDER_MAINNET_DESCRIPTOR,
  BUILDER_SEPOLIA_DESCRIPTOR,
  SetupClient,
  descriptorOriginOf,
  type DeploymentDescriptor,
} from '../../src/index';
import {
  ACCOUNT,
  CONFIGURATION,
  DESCRIPTOR as SETUP_DESCRIPTOR,
  DRAFT,
  OTHER_ACTION,
  codecFor,
  defaultRegistry,
  defaultWorld,
  doubles,
} from '../setup-client/doubles';
import { DESCRIPTOR, EXTRA_MODULE } from './doubles';

const DEFAULTS = [BUILDER_SEPOLIA_DESCRIPTOR, BUILDER_MAINNET_DESCRIPTOR] as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/** The descriptor origin a directly constructed setup client hands its judgments. */
async function originSeenBy(descriptor: DeploymentDescriptor): Promise<unknown> {
  const made = doubles(defaultWorld());
  const client = new SetupClient(
    made.provider,
    descriptor,
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

  return result.warnings.find((warning) => warning.code === 'action.unaudited')?.values['descriptorOrigin'];
}

describe('descriptorOriginOf', () => {
  it.each(DEFAULTS)('reads kit for the shipped default of chain $chainId and for a copy of it', (descriptor) => {
    expect(descriptorOriginOf(descriptor)).toBe('kit');
    expect(descriptorOriginOf({ ...descriptor, shippedMethods: [...descriptor.shippedMethods], auditedActions: [...descriptor.auditedActions] })).toBe('kit');
  });

  it.each(DEFAULTS)('reads integrator for any one field of the default of chain $chainId changed', (descriptor) => {
    const changes: Partial<DeploymentDescriptor>[] = [
      { manager: EXTRA_MODULE },
      { methodEcdsa: EXTRA_MODULE },
      { methodPasskey: EXTRA_MODULE },
      { methodAadhaar: EXTRA_MODULE },
      { methodZkpassport: EXTRA_MODULE },
      { action: EXTRA_MODULE },
      { servedImplementation: EXTRA_MODULE },
      { deployedAt: 1 },
      { digestVersion: '2' },
      { managerVersion: '1.0.1' },
      { shippedMethods: [EXTRA_MODULE] },
      { auditedActions: [EXTRA_MODULE] },
    ];

    for (const change of changes) expect(descriptorOriginOf({ ...descriptor, ...change }), JSON.stringify(change)).toBe('integrator');
  });

  it.each(DEFAULTS)('reads integrator for every member of the default of chain $chainId changed in turn, whatever members the record carries', (descriptor) => {
    const members = Object.keys(descriptor);

    expect(members.length).toBeGreaterThanOrEqual(13);

    for (const member of members) {
      const value = (descriptor as Record<string, unknown>)[member];
      let changed: unknown;

      if (Array.isArray(value)) changed = [...(value as unknown[]), EXTRA_MODULE];
      else if (typeof value === 'number') changed = value + 1;
      else if (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)) changed = EXTRA_MODULE;
      else if (typeof value === 'string') changed = `${value}1`;
      else throw new Error(`no change written for the member ${member}`);

      expect(descriptorOriginOf({ ...descriptor, [member]: changed }), member).toBe('integrator');
    }
  });

  it.each(DEFAULTS)('reads integrator for an audited list of the default of chain $chainId holding any entry, the zero address included', (descriptor) => {
    for (const member of ['shippedMethods', 'auditedActions'] as const) {
      expect(descriptorOriginOf({ ...descriptor, [member]: [EXTRA_MODULE] }), member).toBe('integrator');
      expect(descriptorOriginOf({ ...descriptor, [member]: [ZERO_ADDRESS] }), member).toBe('integrator');
    }
  });

  it('reads integrator for a zero descriptor on a chain no default ships for', () => {
    expect(descriptorOriginOf({ ...BUILDER_SEPOLIA_DESCRIPTOR, chainId: 31_337 })).toBe('integrator');
  });

  it('reads integrator for a working descriptor', () => {
    expect(descriptorOriginOf(DESCRIPTOR)).toBe('integrator');
    expect(descriptorOriginOf(SETUP_DESCRIPTOR)).toBe('integrator');
  });

  it('compares a non-zero address whatever its spelling', () => {
    const differs = { ...BUILDER_SEPOLIA_DESCRIPTOR, manager: EXTRA_MODULE };

    expect(descriptorOriginOf({ ...differs, manager: EXTRA_MODULE.toLowerCase() as typeof EXTRA_MODULE })).toBe('integrator');
  });
});

describe('the setup client', () => {
  it('derives the integrator origin from a working descriptor', async () => {
    expect(await originSeenBy(SETUP_DESCRIPTOR)).toBe('integrator');
  });

  it('derives the kit origin from a shipped default', async () => {
    expect(await originSeenBy(BUILDER_SEPOLIA_DESCRIPTOR)).toBe('kit');
  });
});

describe('the setup client construction', () => {
  it.each([
    ['a working descriptor', SETUP_DESCRIPTOR],
    ['a shipped default', BUILDER_SEPOLIA_DESCRIPTOR],
  ])('asks the provider nothing over %s', (_name, descriptor) => {
    const made = doubles(defaultWorld());

    const client = new SetupClient(made.provider, descriptor, ACCOUNT, OTHER_ACTION, CONFIGURATION, made.manager, made.action, made.events, defaultRegistry(), codecFor(OTHER_ACTION));

    expect(client).toBeInstanceOf(SetupClient);

    expect(made.seen.provider).toEqual([]);
    expect(made.seen.parts).toEqual([]);
  });
});
