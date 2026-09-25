import { METHOD_AADHAAR_ABORT_EVENT, METHOD_AADHAAR_PAIR_WORDS, METHOD_AADHAAR_PUBLIC_INPUT_COUNT, METHOD_AADHAAR_PUBLIC_INPUTS } from '../constants/method-aadhaar';
import type { ReplyFailure, ReplyFailureCause } from '../interfaces';
import type {
  AadhaarArgsOptions,
  AadhaarGroth16,
  AadhaarMaterial,
  AadhaarPcd,
  AadhaarProof,
  AnonAadhaarStack,
} from '../types';
import { AadhaarStackUnavailable } from './stack';
import { parseWord } from './words';

export const failure = (cause: ReplyFailureCause): ReplyFailure => ({ kind: 'reply-failure', cause });

const ABORTED: unique symbol = Symbol('aborted');

/** A signal that threw while this module used it, read as malformed material. */
class AadhaarSignalFault extends Error {
  constructor(cause: unknown) {
    super('the material signal threw while this module read it or added or removed its abort listener', { cause });
    this.name = 'AadhaarSignalFault';
  }
}

/**
 * A call rather than a property read, so no narrowing of `aborted` survives an
 * await; a throwing getter becomes `AadhaarSignalFault`.
 */
function isAborted(signal: AbortSignal | undefined): boolean {
  try {
    return signal?.aborted === true;
  } catch (error) {
    throw new AadhaarSignalFault(error);
  }
}

/** `device-refused` for an aborted signal, `material-rejected` for one whose getter throws, else `undefined`. */
export function abortFailure(signal: AbortSignal | undefined): ReplyFailure | undefined {
  try {
    return isAborted(signal) ? failure('device-refused') : undefined;
  } catch {
    return failure('material-rejected');
  }
}

/**
 * The work's value, or `ABORTED` if the signal fires or reads aborted when the
 * work settles. A signal that throws rejects with `AadhaarSignalFault`.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof ABORTED> {
  if (signal === undefined) return work;

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      resolve(ABORTED);
    };
    const finish = (settle: () => void): void => {
      try {
        signal.removeEventListener(METHOD_AADHAAR_ABORT_EVENT, onAbort);

        if (isAborted(signal)) resolve(ABORTED);
        else settle();
      } catch (error) {
        reject(new AadhaarSignalFault(error));
      }
    };

    work.then(
      (value) => {
        finish(() => {
          resolve(value);
        });
      },
      (error: unknown) => {
        finish(() => {
          reject(error);
        });
      },
    );

    try {
      if (signal.aborted) onAbort();
      else signal.addEventListener(METHOD_AADHAAR_ABORT_EVENT, onAbort, { once: true });
    } catch (error) {
      reject(new AadhaarSignalFault(error));
    }
  });
}

/**
 * Awaits one step under the material's signal: `device-refused` on an abort before,
 * during or after it, `material-rejected` for a signal that throws.
 */
export async function untilSettled<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T | ReplyFailure> {
  try {
    const value = await untilAborted(work, signal);

    return value === ABORTED || isAborted(signal) ? failure('device-refused') : value;
  } catch (error) {
    if (error instanceof AadhaarSignalFault) return failure('material-rejected');

    throw error;
  }
}

const causeOf = (error: unknown): ReplyFailureCause =>
  error instanceof AadhaarStackUnavailable ? 'device-unavailable' : 'material-rejected';

/**
 * Runs the prover once. A QR code whose signature fails under the certificate is
 * `material-rejected`, since the stack then fails the witness.
 */
export async function runProver(
  stack: AnonAadhaarStack,
  options: AadhaarArgsOptions,
  material: AadhaarMaterial,
): Promise<AadhaarPcd | ReplyFailure> {
  const { onProgress, signal } = material;
  const aborted = abortFailure(signal);

  if (aborted !== undefined) return aborted;

  try {
    const args = await untilSettled(stack.generateArgs(options), signal);

    if (isFailure(args)) return args;

    return await untilSettled(stack.prove(args, onProgress, signal), signal);
  } catch (error) {
    return failure(causeOf(error));
  }
}

export const isFailure = (value: unknown): value is ReplyFailure =>
  typeof value === 'object' && value !== null && (value as ReplyFailure).kind === 'reply-failure';

function words(values: readonly unknown[] | undefined, count: number): bigint[] | undefined {
  if (!Array.isArray(values) || values.length < count) return undefined;

  const parsed = values.slice(0, count).map(parseWord);

  return parsed.every((word) => word !== undefined) ? (parsed as bigint[]) : undefined;
}

/**
 * The stack's proof in the proof layout, each `pi_b` pair swapped into the order
 * the verifier takes, or `undefined` when a value is not a `uint256`.
 */
export function packProof(pcd: AadhaarPcd): AadhaarProof | undefined {
  const proof: unknown = pcd?.proof;

  if (typeof proof !== 'object' || proof === null) return undefined;

  const { groth16Proof: groth16, ...signals } = proof as { groth16Proof?: AadhaarGroth16; [name: string]: unknown };
  const a = words(groth16?.pi_a, METHOD_AADHAAR_PAIR_WORDS);
  const b0 = words(groth16?.pi_b?.[0], METHOD_AADHAAR_PAIR_WORDS);
  const b1 = words(groth16?.pi_b?.[1], METHOD_AADHAAR_PAIR_WORDS);
  const c = words(groth16?.pi_c, METHOD_AADHAAR_PAIR_WORDS);
  const inputs = words(METHOD_AADHAAR_PUBLIC_INPUTS.map((name) => signals[name]), METHOD_AADHAAR_PUBLIC_INPUT_COUNT);

  if (a === undefined || b0 === undefined || b1 === undefined || c === undefined || inputs === undefined) return undefined;

  return {
    a: [a[0] ?? 0n, a[1] ?? 0n],
    b: [
      [b0[1] ?? 0n, b0[0] ?? 0n],
      [b1[1] ?? 0n, b1[0] ?? 0n],
    ],
    c: [c[0] ?? 0n, c[1] ?? 0n],
    inputs,
  };
}
