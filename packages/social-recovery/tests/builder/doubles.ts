import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, getAddress } from 'viem';
import { vi } from 'vitest';
import {
  POLICY_MANAGER_EIP712_DOMAIN_ABI,
  POLICY_MANAGER_VERSION_ABI,
  walletMethod,
  type Address,
  type BlockHeader,
  type BlockTag,
  type DeploymentDescriptor,
  type Hex,
  type IEventManager,
  type IPolicyManagerInteractor,
  type IProvider,
  type IRecoveryActionArming,
  type IRecoveryActionInteractor,
  type IRecoveryMethod,
  type ISignerRecovery,
  type IMethodModuleReads,
  type RawLog,
  type RawTransaction,
} from '../../src/index';
import * as Exports from '../../src/index';

/** The run count and seed of a property, taken from `FC_NUM_RUNS` and `FC_SEED`. */
export const FC_PARAMS = {
  numRuns: Number(process.env['FC_NUM_RUNS'] ?? 256),
  ...(process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) }),
};

/** A per-test timeout that grows with the run count. */
export const TIMEOUT = Math.max(10_000, FC_PARAMS.numRuns * 20);

export const SEPOLIA = 11_155_111;
export const MAINNET = 1;
export const ZERO: Address = '0x0000000000000000000000000000000000000000';
export const ACCOUNT: Address = getAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
export const MANAGER: Address = getAddress(`0x${'b1'.repeat(20)}`);
export const OTHER_MANAGER: Address = getAddress(`0x${'b9'.repeat(20)}`);
export const METHOD_ECDSA: Address = getAddress(`0x${'c1'.repeat(20)}`);
export const METHOD_PASSKEY: Address = getAddress(`0x${'c2'.repeat(20)}`);
export const METHOD_AADHAAR: Address = getAddress(`0x${'c3'.repeat(20)}`);
export const METHOD_ZKPASSPORT: Address = getAddress(`0x${'c4'.repeat(20)}`);
export const EXTRA_MODULE: Address = getAddress(`0x${'c5'.repeat(20)}`);
export const ACTION: Address = getAddress(`0x${'d1'.repeat(20)}`);
export const OTHER_ACTION: Address = getAddress(`0x${'d2'.repeat(20)}`);
export const IMPLEMENTATION: Address = getAddress(`0x${'e1'.repeat(20)}`);

/** An integrator's whole descriptor over made-up addresses on Sepolia's chain id. */
export const DESCRIPTOR: DeploymentDescriptor = Object.freeze({
  chainId: SEPOLIA,
  manager: MANAGER,
  methodEcdsa: METHOD_ECDSA,
  methodPasskey: METHOD_PASSKEY,
  methodAadhaar: METHOD_AADHAAR,
  methodZkpassport: METHOD_ZKPASSPORT,
  action: ACTION,
  servedImplementation: IMPLEMENTATION,
  deployedAt: 100,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: Object.freeze([METHOD_ECDSA, METHOD_PASSKEY]),
  auditedActions: Object.freeze([ACTION]),
});

/** What the double's manager answers to `eip712Domain()`, before encoding. */
export type DomainAnswer = {
  readonly fields: Hex;
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: Address;
  readonly salt: Hex;
  readonly extensions: readonly bigint[];
};

/** A failure the double produces in place of an answer. */
export type Failure = { readonly reverts: Hex } | { readonly undecodable: Hex } | { readonly rejects: unknown };

/** Everything the double answers: the provider's chain id and the manager's two views. */
export type ChainWorld = {
  readonly chainId: number | { readonly rejects: unknown };
  readonly domain: DomainAnswer | Failure;
  readonly version: string | Failure;
};

/** The deployed manager's answers for a descriptor: what a matching `PolicyManager` returns. */
export const goodDomain = (descriptor: DeploymentDescriptor = DESCRIPTOR): DomainAnswer => ({
  fields: '0x0f',
  name: 'PolicyManager',
  version: descriptor.digestVersion,
  chainId: descriptor.chainId,
  verifyingContract: getAddress(descriptor.manager),
  salt: `0x${'00'.repeat(32)}`,
  extensions: [],
});

/** A world in which every check passes for the descriptor. */
export const goodWorld = (descriptor: DeploymentDescriptor = DESCRIPTOR): ChainWorld => ({
  chainId: descriptor.chainId,
  domain: goodDomain(descriptor),
  version: descriptor.managerVersion,
});

export const DOMAIN_SELECTOR = encodeFunctionData({ abi: POLICY_MANAGER_EIP712_DOMAIN_ABI, functionName: 'eip712Domain' }).slice(0, 10);
export const VERSION_SELECTOR = encodeFunctionData({ abi: POLICY_MANAGER_VERSION_ABI, functionName: 'version' }).slice(0, 10);

/** One `eth_call` asked of the double. */
export type CallRecord = { readonly to: Address; readonly data: Hex; readonly from: Address; readonly block: BlockTag };

const isFailure = (value: unknown): value is Failure => typeof value === 'object' && value !== null && !('fields' in value);

const fail = (failure: Failure): Hex => {
  if ('reverts' in failure) throw { data: failure.reverts };

  if ('undecodable' in failure) return failure.undecodable;

  throw failure.rejects;
};

/** A provider double with a chain-id knob, answering the manager's two views by selector and recording every read in order. */
export class ChainDouble implements IProvider {
  world: ChainWorld;
  readonly reads: string[] = [];
  readonly calls: CallRecord[] = [];

  constructor(world: ChainWorld = goodWorld()) {
    this.world = world;
  }

  async chainId(): Promise<number> {
    this.reads.push('chainId');

    const answer = this.world.chainId;

    if (typeof answer === 'number') return answer;

    throw answer.rejects;
  }

  async call(to: Address, data: Hex, from: Address, block: BlockTag): Promise<Hex> {
    this.calls.push({ to, data, from, block });

    const selector = data.slice(0, 10).toLowerCase();

    if (selector === DOMAIN_SELECTOR) {
      this.reads.push('eip712Domain');

      const domain = this.world.domain;

      if (isFailure(domain)) return fail(domain);

      return encodeFunctionResult({
        abi: POLICY_MANAGER_EIP712_DOMAIN_ABI,
        functionName: 'eip712Domain',
        result: [domain.fields, domain.name, domain.version, BigInt(domain.chainId), domain.verifyingContract, domain.salt, [...domain.extensions]],
      });
    }

    if (selector === VERSION_SELECTOR) {
      this.reads.push('version');

      const version = this.world.version;

      if (typeof version !== 'string') return fail(version);

      return encodeFunctionResult({ abi: POLICY_MANAGER_VERSION_ABI, functionName: 'version', result: version });
    }

    this.reads.push(`call ${selector}`);

    throw new Error(`unexpected call ${selector}`);
  }

  async logs(): Promise<readonly RawLog[]> {
    this.reads.push('logs');

    return [];
  }

  async block(): Promise<BlockHeader> {
    this.reads.push('block');

    return { number: 1_000, timestamp: 1_760_000_000, hash: `0x${'5b'.repeat(32)}` };
  }

  async code(): Promise<Hex> {
    this.reads.push('code');

    return '0x';
  }

  async transaction(): Promise<RawTransaction | undefined> {
    this.reads.push('transaction');

    return undefined;
  }

  /** How many manager calls the double answered or refused. */
  managerCalls(): number {
    return this.reads.filter((read) => read === 'eip712Domain' || read === 'version').length;
  }

  /** Whether a call to the manager decodes as the given view. */
  static isView(call: CallRecord, name: 'eip712Domain' | 'version'): boolean {
    const abi = name === 'eip712Domain' ? POLICY_MANAGER_EIP712_DOMAIN_ABI : POLICY_MANAGER_VERSION_ABI;

    return decodeFunctionData({ abi, data: call.data }).functionName === name;
  }
}

/** Runs a step that may throw synchronously or reject, folding both into one promise. */
export const attempt = async <T>(step: () => T | Promise<T>): Promise<T> => step();

/** The thrown value of a step that must fail. */
export async function failureOf(step: () => unknown): Promise<unknown> {
  try {
    await step();
  } catch (thrown) {
    return thrown;
  }

  throw new Error('the step did not fail');
}

/** Every exported `BUILDER_*_MESSAGE` value. */
export const builderMessages = (): string[] =>
  Object.entries(Exports)
    .filter(([name, value]) => name.startsWith('BUILDER_') && name.endsWith('_MESSAGE') && typeof value === 'string')
    .map(([, value]) => value as string);

/** The recorded calls of one member of a stub part. */
export const callsOf = (stub: object, member: string): readonly unknown[][] =>
  (stub as Record<string, { readonly mock: { readonly calls: unknown[][] } }>)[member]!.mock.calls;

/** A sentinel a stub part rejects with, so a test can tell a read reached the part. */
export const SENTINEL = new Error('the stub part was reached');

const rejecting = () => vi.fn(async () => {
  throw SENTINEL;
});

/** A replacement manager part whose every member rejects with the sentinel. */
export const managerStub = (): IPolicyManagerInteractor & IMethodModuleReads => {
  const members = [
    'prepareCommitSetup',
    'prepareClearSetup',
    'prepareCancelByOwner',
    'prepareStartAttempt',
    'prepareCancelByProofs',
    'prepareCancelByVeto',
    'stateOf',
    'hashApproval',
    'hashCancel',
    'eip712Domain',
    'name',
    'version',
    'supportsInterface',
    'moduleInfo',
    'paused',
    'trustedParties',
  ];

  return Object.fromEntries(members.map((member) => [member, rejecting()])) as never;
};

/** A replacement action part whose every member rejects with the sentinel. */
export const actionStub = (): IRecoveryActionInteractor & IRecoveryActionArming => {
  const members = ['supportsAccount', 'isAuthority', 'isAuthorized', 'holdsAnyPrivilege', 'actionInfo', 'disarmingCall', 'armingCall'];

  return Object.fromEntries(members.map((member) => [member, rejecting()])) as never;
};

/** A replacement event manager whose filters answer empty and whose fetch rejects with the sentinel. */
export const eventsStub = (): IEventManager =>
  ({
    accountFilter: vi.fn(() => ({ address: [MANAGER], topics: [] })),
    methodFilter: vi.fn(() => ({ address: [MANAGER], topics: [] })),
    privilegeFilter: vi.fn(() => ({ address: [MANAGER], topics: [] })),
    fetch: rejecting(),
    decodeLog: vi.fn(() => undefined),
  }) as never;

/** A signer recovery that never tells. */
export const signerRecoveryStub = (): ISignerRecovery => ({ recoverSigner: vi.fn(async () => undefined) });

/** A codec stub serving the given actions. */
export const codecServing = (...actions: Address[]) => ({
  actions,
  encode: vi.fn(() => '0x' as Hex),
  decode: vi.fn(() => {
    throw new Error('not a handover');
  }),
});

/** A whole shipped method implementation whose `modules` answers the given list instead of its own. */
export function methodServing(modules: readonly Address[]): IRecoveryMethod {
  const base = walletMethod();

  return new Proxy(base, {
    get: (target, key) => (key === 'modules' ? () => modules : Reflect.get(target, key, target)),
  });
}

/** The inputs of a holder over a fresh double. */
export const holder = (provider: IProvider = new ChainDouble(), descriptor: DeploymentDescriptor = DESCRIPTOR) => ({ provider, account: ACCOUNT, descriptor });

/** Whether a value and everything reachable from it is frozen. */
export function deepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;

  if (!Object.isFrozen(value)) return false;

  return Object.values(value).every(deepFrozen);
}

/** A chain double whose `chainId()` waits until the test opens the gate, so a build can be held pending. */
export class GatedDouble extends ChainDouble {
  #open: Promise<void> = Promise.resolve();
  #release: () => void = () => undefined;

  /** Holds every later `chainId()` until `release()`. */
  hold(): void {
    this.#open = new Promise((resolve) => {
      this.#release = resolve;
    });
  }

  /** Lets the held reads answer from the world as it then stands. */
  release(world?: ChainWorld): void {
    if (world !== undefined) this.world = world;

    this.#release();
  }

  override async chainId(): Promise<number> {
    await this.#open;

    return super.chainId();
  }
}

/** A mutable method implementation over the shipped wallet method, claiming the given modules with the given device binding. */
export function methodClaiming(modules: readonly Address[], deviceBinding: string): IRecoveryMethod & { deviceBinding: string } {
  const base = walletMethod();
  const state = { deviceBinding };

  return new Proxy(base, {
    get: (target, key) => {
      if (key === 'modules') return () => modules;

      if (key === 'deviceBinding') return state.deviceBinding;

      return Reflect.get(target, key, target);
    },
    set: (_target, key, value) => {
      if (key !== 'deviceBinding') return false;

      state.deviceBinding = value as string;

      return true;
    },
  }) as IRecoveryMethod & { deviceBinding: string };
}
