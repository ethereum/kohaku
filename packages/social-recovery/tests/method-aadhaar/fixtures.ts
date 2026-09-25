import { encodeAbiParameters, keccak256 } from 'viem';
import type { Address, Ctx, Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { readVector } from '../kat/read-vector';

/** The injectable stack, typed off the factory's own options. */
export type Stack = NonNullable<NonNullable<Parameters<typeof anonAadhaarMethod>[0]>['stack']>;

type GenerateArgsOptions = Parameters<Stack['generateArgs']>[0];
type ProverArgs = Awaited<ReturnType<Stack['generateArgs']>>;
type Pcd = Awaited<ReturnType<Stack['prove']>>;
type Progress = Parameters<Stack['prove']>[1];

export type ConfigRow = {
  readonly input: { readonly nullifier: string; readonly nullifierSeed: string };
  readonly expected: { readonly encoded: Hex };
};

export type Pair = readonly [string, string];

export type UpstreamProof = {
  readonly pi_a: Pair;
  readonly pi_b: readonly [Pair, Pair];
  readonly pi_c: Pair;
};

export type ProofRow = {
  readonly input: { readonly upstreamProof: UpstreamProof; readonly digest: Hex; readonly inputs: readonly string[] };
  readonly expected: {
    readonly a: Pair;
    readonly b: readonly [Pair, Pair];
    readonly c: Pair;
    readonly signalHash: string;
    readonly encoded: Hex;
    readonly byteLength: number;
  };
};

type VectorFile<Row> = { readonly format: string; readonly derivation: string; readonly vectors: readonly Row[] };

/** The first row of a copied vector file; a missing copy or an empty file throws. */
function firstRow<Row>(file: VectorFile<Row>, name: string): Row {
  const row = file.vectors[0];

  if (row === undefined) throw new Error(`vector file ${name} has no rows`);

  return row;
}

export const configFile = readVector('method-aadhaar-config.json') as unknown as VectorFile<ConfigRow>;
export const proofFile = readVector('method-aadhaar-proof.json') as unknown as VectorFile<ProofRow>;
export const configRow: ConfigRow = firstRow(configFile, 'method-aadhaar-config.json');
export const proofRow: ProofRow = firstRow(proofFile, 'method-aadhaar-proof.json');

/** The nine public inputs' names in the verifier's order. */
export const INPUT_ORDER = [
  'pubkeyHash',
  'nullifier',
  'timestamp',
  'ageAbove18',
  'gender',
  'pincode',
  'state',
  'nullifierSeed',
  'signalHash',
] as const;

export const PROOF_ABI = [
  { name: 'a', type: 'uint256[2]' },
  { name: 'b', type: 'uint256[2][2]' },
  { name: 'c', type: 'uint256[2]' },
  { name: 'inputs', type: 'uint256[9]' },
] as const;

export const CONFIG_ABI = [
  { name: 'nullifier', type: 'uint256' },
  { name: 'nullifierSeed', type: 'uint256' },
] as const;

/** `abi.encode(nullifier, nullifierSeed)`, written with viem directly. */
export const configBytes = (nullifier: bigint, nullifierSeed: bigint): Hex =>
  encodeAbiParameters(CONFIG_ABI, [nullifier, nullifierSeed]);

/** `uint256(keccak256(32 digest bytes)) >> 3`, the signal hash the verifier checks. */
export const expectedSignalHash = (digest: Hex): bigint => BigInt(keccak256(digest)) >> 3n;

type NineWords = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

export type ProofWords = {
  readonly a: readonly [bigint, bigint];
  readonly b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  readonly c: readonly [bigint, bigint];
  readonly inputs: NineWords;
};

/** `abi.encode(a, b, c, inputs)` in the proof layout, written with viem directly. */
export const proofBytes = (words: ProofWords): Hex =>
  encodeAbiParameters(PROOF_ABI, [words.a, words.b, words.c, words.inputs]);

export type Signals = { readonly [K in (typeof INPUT_ORDER)[number]]: bigint };

/** The nine signals as words in the verifier's order. */
export const nine = (signals: Signals): NineWords => {
  const [s0, s1, s2, s3, s4, s5, s6, s7, s8] = INPUT_ORDER.map((name) => signals[name]);

  return [s0 ?? 0n, s1 ?? 0n, s2 ?? 0n, s3 ?? 0n, s4 ?? 0n, s5 ?? 0n, s6 ?? 0n, s7 ?? 0n, s8 ?? 0n];
};

/** Synthetic public inputs bound to one config and one digest; overrides break a binding. */
export function signalsFor(nullifier: bigint, nullifierSeed: bigint, digest: Hex, overrides: Partial<Signals> = {}): Signals {
  return {
    pubkeyHash: 99n,
    nullifier,
    timestamp: 1_700_000_000n,
    ageAbove18: 0n,
    gender: 0n,
    pincode: 0n,
    state: 0n,
    nullifierSeed,
    signalHash: expectedSignalHash(digest),
    ...overrides,
  };
}

/** The stack's proof object (snarkjs order, decimal strings) for an upstream proof and nine signals. */
export function pcdOf(upstream: UpstreamProof, signals: Signals): Pcd {
  const named = Object.fromEntries(INPUT_ORDER.map((name) => [name, signals[name].toString()]));

  return {
    proof: {
      pubkeyHash: named['pubkeyHash'] ?? '',
      nullifier: named['nullifier'] ?? '',
      timestamp: named['timestamp'] ?? '',
      ageAbove18: named['ageAbove18'] ?? '',
      gender: named['gender'] ?? '',
      pincode: named['pincode'] ?? '',
      state: named['state'] ?? '',
      nullifierSeed: named['nullifierSeed'] ?? '',
      signalHash: named['signalHash'] ?? '',
      groth16Proof: {
        pi_a: [...upstream.pi_a, '1'],
        pi_b: [[...upstream.pi_b[0]], [...upstream.pi_b[1]], ['1', '0']],
        pi_c: [...upstream.pi_c, '1'],
        protocol: 'groth16',
        curve: 'bn128',
      },
    },
  };
}

/** The proof row's upstream proof and inputs as the stack would return them. */
export function vectorPcd(row: ProofRow): Pcd {
  const values = row.input.inputs.map((value) => BigInt(value));
  const signals = Object.fromEntries(INPUT_ORDER.map((name, index) => [name, values[index] ?? 0n])) as Signals;

  return pcdOf(row.input.upstreamProof, signals);
}

export const SYNTHETIC_UPSTREAM: UpstreamProof = {
  pi_a: ['11', '12'],
  pi_b: [
    ['13', '14'],
    ['15', '16'],
  ],
  pi_c: ['17', '18'],
};

export type Behaviour = 'resolve' | 'throw' | 'hang' | 'hang-until-aborted';

export type DoubleOptions = {
  readonly pcd?: Pcd;
  readonly generateArgs?: Behaviour;
  readonly prove?: Behaviour;
  /** The verdict to answer; `'throw'` rejects as the stack does on an issuer-key mismatch. */
  readonly verify?: boolean | 'throw';
  /** Progress states the double reports before resolving. */
  readonly progress?: readonly string[];
};

export type ProveCall = {
  readonly args: ProverArgs;
  readonly onProgress: Progress;
  readonly signal: AbortSignal | undefined;
  /** How many arguments the call carried. */
  readonly arity: number;
};

export type StackDouble = {
  readonly stack: Stack;
  readonly generateArgsCalls: GenerateArgsOptions[];
  readonly proveCalls: ProveCall[];
  readonly verifyCalls: Pcd[];
  readonly order: string[];
  /** Resolves once `prove` has been entered. */
  readonly proving: Promise<void>;
  readonly total: () => number;
};

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

function untilAborted<T>(signal: AbortSignal | undefined): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
}

function act<T>(behaviour: Behaviour, value: T, signal: AbortSignal | undefined, what: string): Promise<T> {
  if (behaviour === 'throw') return Promise.reject(new Error(`${what}: the signature does not verify`));

  if (behaviour === 'hang') return never<T>();

  if (behaviour === 'hang-until-aborted') return untilAborted<T>(signal);

  return Promise.resolve(value);
}

/** A prover double over exactly the surface the method uses, recording every call. */
export function stackDouble(options: DoubleOptions = {}): StackDouble {
  const generateArgsCalls: GenerateArgsOptions[] = [];
  const proveCalls: ProveCall[] = [];
  const verifyCalls: Pcd[] = [];
  const order: string[] = [];
  const pcd = options.pcd ?? pcdOf(SYNTHETIC_UPSTREAM, signalsFor(1n, 1n, `0x${'00'.repeat(32)}`));
  let entered: () => void = () => undefined;
  const proving = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const argsToken: ProverArgs = { circuitArguments: 'from the double' };

  const stack: Stack = {
    generateArgs: (argsOptions) => {
      order.push('generateArgs');
      generateArgsCalls.push(argsOptions);

      return act(options.generateArgs ?? 'resolve', argsToken, undefined, 'generateArgs');
    },
    prove: (...call: Parameters<Stack['prove']>) => {
      const [args, onProgress, signal] = call;

      order.push('prove');
      proveCalls.push({ args, onProgress, signal, arity: call.length });
      entered();

      const behaviour = options.prove ?? 'resolve';

      if (behaviour === 'resolve') for (const state of options.progress ?? ['proving', 'completed']) onProgress?.(state);

      return act(behaviour, pcd, signal, 'prove');
    },
    verify: (checked) => {
      order.push('verify');
      verifyCalls.push(checked);

      const answer = options.verify ?? true;

      return answer === 'throw' ? Promise.reject(new Error('VerificationError: public key mismatch.')) : Promise.resolve(answer);
    },
  };

  return {
    stack,
    generateArgsCalls,
    proveCalls,
    verifyCalls,
    order,
    proving,
    total: () => order.length,
  };
}

const ZERO_HASH: Hex = `0x${'00'.repeat(32)}`;
const addr = (byte: string): Address => `0x${byte.repeat(20)}`;

/** A `Ctx` written by hand: one cancellation request for place 1 carrying the given config and digest. */
export function ctxFor(config: Hex, digest: Hex): Ctx {
  return {
    request: {
      kind: 'recovery-proof-request',
      version: 1,
      chainId: '11155111',
      manager: addr('11'),
      digestVersion: '1',
      account: addr('22'),
      action: addr('33'),
      attemptId: '1',
      setupNonce: '0',
      setupBodyHash: ZERO_HASH,
      validUntil: '1800000000',
      place: 1,
      method: addr('44'),
      config,
      salt: ZERO_HASH,
      credentialHoldsCode: false,
      purpose: 'cancellation',
    },
    place: 1,
    digest,
    typedData: {
      domain: { name: 'PolicyManager', version: '1', chainId: 11155111, verifyingContract: addr('11') },
      types: {},
      primaryType: 'Cancellation',
      message: {
        account: addr('22'),
        action: addr('33'),
        attemptId: 1n,
        setupNonce: 0n,
        setupBodyHash: ZERO_HASH,
        validUntil: 1800000000,
        place: 1,
      },
    },
  };
}

export const CERTIFICATE = '-----BEGIN CERTIFICATE-----\nMIIBsynthetic\n-----END CERTIFICATE-----\n';
export const QR_DATA = '123456789012345678901234567890';

/** Whether `value` is a reply failure with the given cause. */
export const isFailure = (value: unknown, cause: string): boolean =>
  typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'reply-failure' &&
  (value as { cause?: unknown }).cause === cause;

/** The last 32 bytes of the proof bytes as a number: the signal hash word. */
export const lastWord = (proof: Hex): bigint => BigInt(`0x${proof.slice(-64)}`);
