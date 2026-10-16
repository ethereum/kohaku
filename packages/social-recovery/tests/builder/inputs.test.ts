import { describe, expect, it } from 'vitest';
import {
  BUILDER_BLOCK_TAGS,
  BUILDER_CANCEL_WINDOW,
  BUILDER_DEFAULT_CONFIGURATION,
  BUILDER_DEFAULT_DESCRIPTORS,
  BUILDER_DEFAULT_LOG_CHUNK_SIZE,
  BUILDER_DEFAULT_WAIT,
  BUILDER_DOMAIN_FIELDS,
  BUILDER_MAINNET_DESCRIPTOR,
  BUILDER_MAX_WAIT,
  BUILDER_REQUEST_WINDOW,
  BUILDER_RULE_COST_BOUND,
  BUILDER_SEPOLIA_DESCRIPTOR,
  BUILDER_SHORT_WAIT,
  DEVICE_BINDINGS,
  KitRefusalError,
  SocialRecoveryBuilder,
  checkedDescriptor,
  type DeploymentDescriptor,
  type SocialRecoveryInputs,
} from '../../src/index';
import {
  ACCOUNT,
  ChainDouble,
  DESCRIPTOR,
  MAINNET,
  SEPOLIA,
  ZERO,
  attempt,
  builderMessages,
  codecServing,
  deepFrozen,
  failureOf,
  goodWorld,
  holder,
} from './doubles';

/** Builds a setup client from loosely typed inputs, so a malformed shape reaches the run-time checks. */
const buildFrom = (inputs: unknown) => attempt(() => SocialRecoveryBuilder.from(inputs as SocialRecoveryInputs as never).buildSetupClient());

const ADDRESS_FIELDS = ['manager', 'methodEcdsa', 'methodPasskey', 'methodAadhaar', 'methodZkpassport', 'action', 'servedImplementation'] as const;

describe('the exported defaults', () => {
  it('ship the six client numbers, the tags, the chunk width and the domain bitmap', () => {
    expect(BUILDER_DEFAULT_WAIT).toBe(172_800);
    expect(BUILDER_SHORT_WAIT).toBe(172_800);
    expect(BUILDER_MAX_WAIT).toBe(2_592_000);
    expect(BUILDER_REQUEST_WINDOW).toEqual({ default: 86_400, floor: 3_600 });
    expect(BUILDER_CANCEL_WINDOW).toBe(43_200);
    expect(BUILDER_RULE_COST_BOUND).toBe(10_000_000);
    expect(BUILDER_BLOCK_TAGS).toEqual({ read: 'latest', watch: 'finalized' });
    expect(BUILDER_DEFAULT_LOG_CHUNK_SIZE).toBe(10_000);
    expect(BUILDER_DOMAIN_FIELDS).toBe('0x0f');
  });

  it('ship the whole default configuration', () => {
    expect(BUILDER_DEFAULT_CONFIGURATION).toEqual({
      defaultWait: 172_800,
      shortWait: 172_800,
      maxWait: 2_592_000,
      requestWindow: { default: 86_400, floor: 3_600 },
      cancelWindow: 43_200,
      ruleCostBound: 10_000_000,
      candidateKeys: [],
      blockTags: { read: 'latest', watch: 'finalized' },
      logChunkSize: 10_000,
      tokens: [],
      simulate: true,
    });
  });

  it('ship the two descriptors on their real chain ids with every address zero', () => {
    for (const [descriptor, chainId] of [
      [BUILDER_SEPOLIA_DESCRIPTOR, SEPOLIA],
      [BUILDER_MAINNET_DESCRIPTOR, MAINNET],
    ] as const) {
      expect(descriptor.chainId).toBe(chainId);
      expect(descriptor.digestVersion).toBe('1');
      expect(descriptor.managerVersion).toBe('1.0.0');
      expect(descriptor.deployedAt).toBe(0);
      expect(descriptor.shippedMethods).toEqual([]);
      expect(descriptor.auditedActions).toEqual([]);

      for (const field of ADDRESS_FIELDS) expect(descriptor[field]).toBe(ZERO);

      expect(BUILDER_DEFAULT_DESCRIPTORS[chainId]).toEqual(descriptor);
    }

    expect(Object.keys(BUILDER_DEFAULT_DESCRIPTORS).map(Number).sort((a, b) => a - b)).toEqual([MAINNET, SEPOLIA]);
    expect(JSON.stringify(BUILDER_DEFAULT_DESCRIPTORS)).not.toMatch(/0x(?!0{40})[0-9a-fA-F]{40}/);
  });

  it('are deep-frozen', () => {
    for (const value of [
      BUILDER_DEFAULT_CONFIGURATION,
      BUILDER_DEFAULT_DESCRIPTORS,
      BUILDER_SEPOLIA_DESCRIPTOR,
      BUILDER_MAINNET_DESCRIPTOR,
      BUILDER_REQUEST_WINDOW,
      BUILDER_BLOCK_TAGS,
    ]) {
      expect(deepFrozen(value)).toBe(true);
    }
  });
});

describe('the holder inputs', () => {
  it.each([
    ['no provider', { account: ACCOUNT, descriptor: DESCRIPTOR }],
    ['no account', { provider: new ChainDouble(), descriptor: DESCRIPTOR }],
    ['a provider missing a member', { provider: { chainId: async () => SEPOLIA }, account: ACCOUNT, descriptor: DESCRIPTOR }],
    ['a malformed account', { ...holder(), account: '0x1234' }],
    ['an account with a broken checksum', { ...holder(), account: '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' }],
    ['a descriptor missing a field', { ...holder(), descriptor: { ...DESCRIPTOR, servedImplementation: undefined } }],
    ['a descriptor with a malformed address', { ...holder(), descriptor: { ...DESCRIPTOR, manager: '0xnope' } }],
    ['a null input', null],
    ['a string input', 'inputs'],
  ])('refuse %s with a TypeError or RangeError before any read', async (_name, inputs) => {
    const provider = (inputs as { provider?: unknown } | null)?.provider;
    const thrown = await failureOf(() => buildFrom(inputs));

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);

    if (provider instanceof ChainDouble) expect(provider.reads).toEqual([]);
  });

  it('refuse a chain id disagreeing with the descriptor with a RangeError at from', () => {
    expect(() => SocialRecoveryBuilder.from({ ...holder(), chainId: MAINNET })).toThrow(RangeError);
  });

  it('accept a chain id agreeing with the descriptor', async () => {
    await expect(SocialRecoveryBuilder.from({ ...holder(), chainId: SEPOLIA }).buildSetupClient()).resolves.toBeDefined();
  });

  it('refuse a merged configuration the record check refuses, before any read', async () => {
    for (const configuration of [{ logChunkSize: 0 }, { candidateKeys: [ACCOUNT, ACCOUNT] }, { blockTags: { read: 'pending', watch: 'latest' } }]) {
      const provider = new ChainDouble();
      const thrown = await failureOf(() => buildFrom({ ...holder(provider), configuration }));

      expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
      expect(provider.reads).toEqual([]);
    }
  });

  it('derive the chain id from the provider when neither a descriptor nor a chain id is given, then refuse the zero default', async () => {
    for (const chainId of [SEPOLIA, MAINNET]) {
      const provider = new ChainDouble({ ...goodWorld(), chainId });
      const thrown = await failureOf(() => SocialRecoveryBuilder.from({ provider, account: ACCOUNT }).buildSetupClient());

      expect(thrown).toBeInstanceOf(KitRefusalError);
      expect(builderMessages()).toContain((thrown as Error).message);
      expect(provider.reads).toEqual(['chainId']);
    }
  });

  it('refuse the zero default of a named chain with one fixed message and no manager call', async () => {
    const messages = new Set<string>();

    for (const chainId of [SEPOLIA, MAINNET]) {
      const provider = new ChainDouble({ ...goodWorld(), chainId });
      const thrown = await failureOf(() => buildFrom({ provider, account: ACCOUNT, chainId }));

      expect(thrown).toBeInstanceOf(KitRefusalError);
      messages.add((thrown as Error).message);
      expect(provider.managerCalls()).toBe(0);
    }

    expect(messages.size).toBe(1);
  });

  it('refuse a chain no default ships for', async () => {
    const named = new ChainDouble({ ...goodWorld(), chainId: 31_337 });

    expect(await failureOf(() => buildFrom({ provider: named, account: ACCOUNT, chainId: 31_337 }))).toBeInstanceOf(KitRefusalError);
    expect(named.managerCalls()).toBe(0);

    const derived = new ChainDouble({ ...goodWorld(), chainId: 31_337 });

    expect(await failureOf(() => buildFrom({ provider: derived, account: ACCOUNT }))).toBeInstanceOf(KitRefusalError);
    expect(derived.managerCalls()).toBe(0);
  });

  it('refuse a descriptor on another chain than the provider at the chain id check', async () => {
    const provider = new ChainDouble({ ...goodWorld(), chainId: MAINNET });
    const thrown = await failureOf(() => buildFrom(holder(provider)));

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(provider.reads).toEqual(['chainId']);
  });
});

describe('the approver inputs', () => {
  it.each([
    ['an empty object', {}],
    ['bindings alone', { deviceBindings: ['none'] }],
  ])('refuse %s with a TypeError', (_name, inputs) => {
    expect(() => SocialRecoveryBuilder.from(inputs as never).buildMethodsOrchestrator()).toThrow(TypeError);
  });

  it('build the orchestrator synchronously from a descriptor alone', () => {
    const orchestrator = SocialRecoveryBuilder.from({ descriptor: DESCRIPTOR }).buildMethodsOrchestrator();

    expect(orchestrator).not.toBeInstanceOf(Promise);
    expect(typeof orchestrator.enrollInput).toBe('function');
  });

  it('refuse a chain id disagreeing with the descriptor with a RangeError', () => {
    expect(() => SocialRecoveryBuilder.from({ descriptor: DESCRIPTOR, chainId: MAINNET })).toThrow(RangeError);
  });

  it.each(['build', 'buildSetupClient', 'buildRecoveryClient', 'recoveryAction', 'methodModuleReads'] as const)(
    'refuse %s at run time with a TypeError',
    async (member) => {
      const builder = SocialRecoveryBuilder.from({ descriptor: DESCRIPTOR }) as unknown as Record<string, () => unknown>;

      expect(await failureOf(() => builder[member]!())).toBeInstanceOf(TypeError);
    },
  );

  it('leave the setters open after a refused client build', async () => {
    const builder = SocialRecoveryBuilder.from({ descriptor: DESCRIPTOR });

    await failureOf(() => (builder as unknown as { build: () => unknown }).build());

    expect(() => builder.withCodec(codecServing(DESCRIPTOR.action))).not.toThrow();
  });

  it('take the bindings list it is given', () => {
    for (const deviceBindings of [[...DEVICE_BINDINGS], ['none'] as const]) {
      expect(() => SocialRecoveryBuilder.from({ descriptor: DESCRIPTOR, deviceBindings }).buildMethodsOrchestrator()).not.toThrow();
    }
  });

  it('refuse a malformed bindings list', async () => {
    const thrown = await failureOf(() => SocialRecoveryBuilder.from({ descriptor: DESCRIPTOR, deviceBindings: ['telepathy'] as never }).buildMethodsOrchestrator());

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
  });
});

describe('a descriptor that differs from the default', () => {
  it('is used whole, never merged with the default', async () => {
    const descriptor: DeploymentDescriptor = { ...DESCRIPTOR };
    const builder = SocialRecoveryBuilder.from(holder(new ChainDouble(), descriptor));

    await builder.buildSetupClient();

    expect(builder.managerReading()?.manager).toBe(DESCRIPTOR.manager);
  });
});

describe('the shipped descriptors', () => {
  it.each([
    ['Sepolia', BUILDER_SEPOLIA_DESCRIPTOR],
    ['mainnet', BUILDER_MAINNET_DESCRIPTOR],
  ])('of %s are already the checked record, member for member', (_name, descriptor) => {
    const checked = checkedDescriptor(descriptor, 'descriptor');

    expect(Object.keys(descriptor).sort()).toEqual(Object.keys(checked).sort());

    for (const member of Object.keys(checked)) {
      expect((descriptor as Record<string, unknown>)[member], member).toEqual((checked as Record<string, unknown>)[member]);
    }
  });
});

/** The message of the TypeError `from` throws for the inputs, failing the test when it throws none. */
function fromRefusal(inputs: unknown): string {
  let thrown: unknown;

  try {
    SocialRecoveryBuilder.from(inputs as never);
  } catch (caught) {
    thrown = caught;
  }

  expect(thrown).toBeInstanceOf(TypeError);

  return (thrown as TypeError).message;
}

describe('an inputs object carrying a member of its own', () => {
  it.each([
    ['a misspelt configuration on a holder', 'configuraton', (provider: ChainDouble) => ({ ...holder(provider), configuraton: { simulate: false } })],
    ['a singular binding list on a holder', 'deviceBinding', (provider: ChainDouble) => ({ ...holder(provider), deviceBinding: ['none'] })],
    ['an unknown member on a holder with no descriptor', 'descripton', (provider: ChainDouble) => ({ provider, account: ACCOUNT, descripton: DESCRIPTOR })],
  ])('refuses %s with a TypeError naming it at from, before any read', (_name, member, make) => {
    const provider = new ChainDouble();

    expect(fromRefusal(make(provider))).toContain(member);
    expect(provider.reads).toEqual([]);
  });

  it.each([
    ['a chain id', 'configuration', { chainId: SEPOLIA, configuration: { simulate: false } }],
    ['a descriptor', 'configuration', { descriptor: DESCRIPTOR, configuration: {} }],
    ['a chain id', 'account', { chainId: SEPOLIA, account: ACCOUNT }],
    ['a descriptor', 'account', { descriptor: DESCRIPTOR, account: ACCOUNT }],
    ['a descriptor', 'deviceBinding', { descriptor: DESCRIPTOR, deviceBinding: ['none'] }],
  ])('refuses an approver over %s carrying %s with a TypeError naming it at from', (_name, member, inputs) => {
    expect(fromRefusal(inputs)).toContain(member);
  });

  it.each([
    ['a hidden misspelt configuration on a holder', 'configuraton', (provider: ChainDouble) => Object.defineProperty(holder(provider), 'configuraton', { value: {} })],
    ['a symbol key on a holder', 'configuraton', (provider: ChainDouble) => ({ ...holder(provider), [Symbol('configuraton')]: {} })],
    ['a hidden misspelt binding list on a holder', 'deviceBinding', (provider: ChainDouble) => Object.defineProperty(holder(provider), 'deviceBinding', { value: ['none'], enumerable: false })],
  ])('refuses %s with a TypeError naming it at from, before any read', (_name, member, make) => {
    const provider = new ChainDouble();

    expect(fromRefusal(make(provider))).toContain(member);
    expect(provider.reads).toEqual([]);
  });

  it.each([
    ['a hidden misspelt configuration over a chain id', 'configuraton', () => Object.defineProperty({ chainId: SEPOLIA }, 'configuraton', { value: {} })],
    ['a hidden configuration over a chain id', 'configuration', () => Object.defineProperty({ chainId: SEPOLIA }, 'configuration', { value: {} })],
    ['a hidden configuration over a descriptor', 'configuration', () => Object.defineProperty({ descriptor: DESCRIPTOR }, 'configuration', { value: {} })],
    ['a symbol key over a chain id', 'configuraton', () => ({ chainId: SEPOLIA, [Symbol('configuraton')]: {} })],
    ['a symbol key over a descriptor', 'configuraton', () => ({ descriptor: DESCRIPTOR, [Symbol('configuraton')]: {} })],
  ])('refuses an approver carrying %s with a TypeError naming it at from', (_name, member, make) => {
    expect(fromRefusal(make())).toContain(member);
  });

  it('accepts a symbol or a hidden member it inherits', async () => {
    const proto = Object.defineProperty({ [Symbol('configuraton')]: {} }, 'configuraton', { value: {} });
    const holderInputs = Object.assign(Object.create(proto) as object, holder());
    const approverInputs = Object.assign(Object.create(proto) as object, { descriptor: DESCRIPTOR });

    await SocialRecoveryBuilder.from(holderInputs as never).buildSetupClient();

    expect(() => SocialRecoveryBuilder.from(approverInputs as never).buildMethodsOrchestrator()).not.toThrow();
  });

  it('accepts a member it inherits, on a holder and on an approver', async () => {
    const holderInputs = Object.assign(Object.create({ configuraton: { simulate: false }, deviceBinding: ['none'] }) as object, holder());
    const approverInputs = Object.assign(Object.create({ configuration: {}, configuraton: {} }) as object, { descriptor: DESCRIPTOR });

    await SocialRecoveryBuilder.from(holderInputs as never).buildSetupClient();

    expect(() => SocialRecoveryBuilder.from(approverInputs as never).buildMethodsOrchestrator()).not.toThrow();
  });

  it('accepts every member the two shapes name', async () => {
    const provider = new ChainDouble();
    const full = { provider, account: ACCOUNT, descriptor: DESCRIPTOR, chainId: SEPOLIA, configuration: {}, deviceBindings: ['none'] as const };

    await SocialRecoveryBuilder.from(full).buildSetupClient();

    expect(() => SocialRecoveryBuilder.from({ descriptor: DESCRIPTOR, chainId: SEPOLIA, deviceBindings: ['none'] }).buildMethodsOrchestrator()).not.toThrow();
  });
});
