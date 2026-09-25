import { encodeAbiParameters } from 'viem';
import type { zkPassportMethod } from '../../src/method-zkpassport';
import type { Address, Ctx, DeploymentDescriptor, Hex } from '../../src/interfaces';

/** The stack the factory takes, named from the factory's own signature rather than a deep import. */
export type Stack = NonNullable<Parameters<typeof zkPassportMethod>[0]>;

type Client = Awaited<ReturnType<Stack>>;

type VerifierArgs = Parameters<Client['getSolidityVerifierParameters']>[0];

type VerifierParameters = ReturnType<Client['getSolidityVerifierParameters']>;

/** One call the double saw, in order. */
export type StackCall =
  | { readonly kind: 'construct'; readonly domain: string }
  | { readonly kind: 'request'; readonly domain: string; readonly args: unknown }
  | { readonly kind: 'bind'; readonly domain: string; readonly key: string; readonly value: string }
  | { readonly kind: 'done'; readonly domain: string }
  | { readonly kind: 'callback'; readonly domain: string; readonly name: string }
  | { readonly kind: 'verifier-parameters'; readonly domain: string; readonly args: VerifierArgs };

/** What the verifier-parameter call answers, before the double echoes the service config. */
export type OuterMaterial = {
  readonly version: string;
  readonly vkeyHash: string;
  readonly proof: string;
  readonly publicInputs: readonly string[];
  readonly committedInputs: string;
  readonly validityPeriodInSeconds: number;
};

export type StackDoubleOptions = {
  readonly outer?: OuterMaterial;
  /** Replaces the service config's echo, to model a stack that answers something else. */
  readonly serviceConfig?: (args: VerifierArgs) => VerifierParameters['serviceConfig'];
  readonly constructThrows?: boolean;
  readonly verifierThrows?: boolean;
};

export type StackDouble = {
  readonly stack: Stack;
  readonly calls: StackCall[];
};

const CALLBACKS = [
  'onRequestReceived',
  'onGeneratingProof',
  'onProofGenerated',
  'onSuccess',
  'onReject',
  'onError',
] as const;

/** A 32-byte word from a number, `0x` and 64 lowercase hex characters. */
export const word = (value: bigint | number): Hex => `0x${BigInt(value).toString(16).padStart(64, '0')}`;

/** The public inputs of an outer proof whose last three are the nullifier type, the scoped nullifier and a trailing word. */
export const outerInputs = (identifier: bigint, nullifierType = 0n): string[] => [
  word(0x21),
  word(0x22),
  word(0x23),
  word(nullifierType),
  word(identifier),
  word(0x24),
];

/** The identifier the default outer proof carries at publicInputs[len-2], as the stack's result reports it (decimal). */
export const IDENTIFIER = 0x0badc0ffeen;

/** Synthetic outer-proof material of this suite's own, distinct from the vector rows. */
export const DEFAULT_OUTER: OuterMaterial = {
  version: '0x0000001500020000000000000000000000000000000000000000000000000000',
  vkeyHash: word(0x77),
  proof: '0xabcdef01',
  publicInputs: outerInputs(IDENTIFIER),
  committedInputs: '0xbeef',
  validityPeriodInSeconds: 604800,
};

/** A stack double: `stack(domain)` stands for `new ZKPassport(domain)`, and every call is recorded. */
export function stackDouble(options: StackDoubleOptions = {}): StackDouble {
  const calls: StackCall[] = [];
  const outer = options.outer ?? DEFAULT_OUTER;

  const stack: Stack = (domain: string) => {
    calls.push({ kind: 'construct', domain });

    if (options.constructThrows === true) throw new Error('double: the stack does not load');

    return {
      request: async (args) => {
        calls.push({ kind: 'request', domain, args });

        const bound: string[] = [];

        const builder = {
          bind: (key: 'custom_data', value: string) => {
            calls.push({ kind: 'bind', domain, key, value });
            bound.push(value);

            return builder;
          },
          done: () => {
            calls.push({ kind: 'done', domain });

            const register = (name: string) => () => {
              calls.push({ kind: 'callback', domain, name });
            };

            const query = new URLSearchParams({ domain, scope: args.scope, bound: bound.join(',') });

            return {
              url: `https://double.invalid/r?${query.toString()}`,
              requestId: `request-${calls.length}`,
              onRequestReceived: register('onRequestReceived'),
              onGeneratingProof: register('onGeneratingProof'),
              onProofGenerated: register('onProofGenerated'),
              onSuccess: register('onSuccess'),
              onReject: register('onReject'),
              onError: register('onError'),
            };
          },
        };

        return builder;
      },
      getSolidityVerifierParameters: (args) => {
        calls.push({ kind: 'verifier-parameters', domain, args });

        if (options.verifierThrows === true) throw new Error('double: not an outer_evm proof');

        return {
          version: outer.version,
          proofVerificationData: {
            vkeyHash: outer.vkeyHash,
            proof: outer.proof,
            publicInputs: [...outer.publicInputs],
          },
          committedInputs: outer.committedInputs,
          serviceConfig: options.serviceConfig?.(args) ?? {
            validityPeriodInSeconds: outer.validityPeriodInSeconds,
            domain: args.domain,
            scope: args.scope,
            devMode: args.devMode,
          },
        };
      },
    };
  };

  return { stack, calls };
}

export const CALLBACK_NAMES: readonly string[] = CALLBACKS;

/** One proof as the stack's `ProofResult` carries it, with the bind circuit's custom data where given. */
export const stackProof = (name: string, customData?: string): { readonly [member: string]: unknown } => ({
  name,
  proof: '0xdead',
  committedInputs: customData === undefined ? {} : { bind_evm: { data: { custom_data: customData } } },
});

export const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';

const address = (last: number): Address => `0x${last.toString(16).padStart(40, '0')}`;

export const DESCRIPTOR: DeploymentDescriptor = {
  chainId: 11155111,
  manager: address(1),
  methodEcdsa: address(2),
  methodPasskey: address(3),
  methodAadhaar: address(4),
  methodZkpassport: address(5),
  action: address(6),
  servedImplementation: address(7),
  deployedAt: 1,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [address(2), address(3), address(4), address(5)],
  auditedActions: [address(6)],
};

/** A `Ctx` built by hand, the orchestrator's record, for one approval place. */
export function makeCtx(config: Hex, digest: Hex = DIGEST): Ctx {
  return {
    request: {
      kind: 'recovery-proof-request',
      version: 1,
      chainId: '11155111',
      manager: DESCRIPTOR.manager,
      digestVersion: '1',
      account: address(0xa),
      action: DESCRIPTOR.action,
      attemptId: '1',
      setupNonce: '0',
      setupBodyHash: word(0xbb),
      validUntil: '1900000000',
      place: 0,
      method: DESCRIPTOR.methodZkpassport,
      config,
      salt: word(0x5a),
      credentialHoldsCode: false,
      purpose: 'approval',
      payload: '0x',
      order: { token: address(0), amount: '0', payee: address(0) },
    },
    place: 0,
    digest,
    typedData: {
      domain: { name: 'PolicyManager', version: '1', chainId: 11155111, verifyingContract: DESCRIPTOR.manager },
      types: {},
      primaryType: 'Cancellation',
      message: {
        account: address(0xa),
        action: DESCRIPTOR.action,
        attemptId: 1n,
        setupNonce: 0n,
        setupBodyHash: word(0xbb),
        validUntil: 1900000000,
        place: 0,
      },
    },
  };
}

/** The config layout the vector's derivation names, encoded here with viem, independently of the codec. */
export const encodeConfig = (identifier: Hex, version: Hex, domain: string, scope: string, validity: bigint): Hex =>
  encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'string' }, { type: 'string' }, { type: 'uint256' }],
    [identifier, version, domain, scope, validity],
  );

/** The proof layout the vector's derivation names, encoded here with viem, independently of the codec. */
export const encodeProof = (vkeyHash: Hex, proof: Hex, publicInputs: readonly Hex[], committedInputs: Hex): Hex =>
  encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'vkeyHash', type: 'bytes32' },
          { name: 'proof', type: 'bytes' },
          { name: 'publicInputs', type: 'bytes32[]' },
        ],
      },
      { type: 'bytes' },
    ],
    [{ vkeyHash, proof, publicInputs: [...publicInputs] }, committedInputs],
  );

export const PARAMS = {
  domain: 'recover.example',
  scope: 'mast-social-recovery',
  name: 'Recovery kit',
  logo: 'https://recover.example/logo.png',
  purpose: 'Approve a recovery',
} as const;

/** A member of a vector row's record, by path, typed at the call. */
export function member(record: unknown, ...path: string[]): unknown {
  let at: unknown = record;

  for (const key of path) {
    if (typeof at !== 'object' || at === null) return undefined;

    at = (at as { readonly [key: string]: unknown })[key];
  }

  return at;
}

export const asHex = (value: unknown): Hex => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) throw new Error(`not hex: ${String(value)}`);

  return value as Hex;
};

export const asText = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error(`not a string: ${String(value)}`);

  return value;
};
