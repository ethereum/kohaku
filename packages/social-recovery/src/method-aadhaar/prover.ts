import {
  METHOD_AADHAAR_ABORT_EVENT,
  METHOD_AADHAAR_DEVICE_REFUSED,
  METHOD_AADHAAR_DEVICE_UNAVAILABLE,
  METHOD_AADHAAR_MATERIAL_REJECTED,
  METHOD_AADHAAR_PUBLIC_INPUTS,
  METHOD_AADHAAR_PUBLIC_INPUT_COUNT,
  METHOD_AADHAAR_SIGNAL_FAULT_MESSAGE,
} from '../constants/method-aadhaar';
import type { ReplyFailure } from '../interfaces';
import type {
  AadhaarArgsOptions,
  AadhaarGroth16,
  AadhaarMaterial,
  AadhaarPcd,
  AadhaarProgress,
  AadhaarProof,
  AnonAadhaarStack,
} from '../types/method-aadhaar';
import { AadhaarStackUnavailable } from './stack';
import { parsePair, parseWords } from './words';

const ABORTED: unique symbol = Symbol('aborted');

/** A signal that threw while this module used it, read as malformed material. */
class AadhaarSignalFault extends Error {
  constructor(cause: unknown) {
    super(METHOD_AADHAAR_SIGNAL_FAULT_MESSAGE, { cause });
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
    return isAborted(signal) ? METHOD_AADHAAR_DEVICE_REFUSED : undefined;
  } catch {
    return METHOD_AADHAAR_MATERIAL_REJECTED;
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

    return value === ABORTED || isAborted(signal) ? METHOD_AADHAAR_DEVICE_REFUSED : value;
  } catch (error) {
    if (error instanceof AadhaarSignalFault) return METHOD_AADHAAR_MATERIAL_REJECTED;

    throw error;
  }
}

const failureOf = (error: unknown): ReplyFailure =>
  error instanceof AadhaarStackUnavailable ? METHOD_AADHAAR_DEVICE_UNAVAILABLE : METHOD_AADHAAR_MATERIAL_REJECTED;

/** The page's callback, forwarding a state only until the call settles and while the signal reads neither aborted nor throwing. */
function gatedProgress(onProgress: AadhaarProgress | undefined, signal: AbortSignal | undefined, settled: () => boolean): AadhaarProgress | undefined {
  if (onProgress === undefined) return undefined;

  return (state) => {
    if (!settled() && abortFailure(signal) === undefined) onProgress(state);
  };
}

/**
 * Runs the prover once. A QR code whose signature fails under the certificate is
 * `material-rejected`, since the stack then fails the witness. The stack gets the page's progress gated on the signal and on
 * the call: an abort settles the call `device-refused` at once, and no state is forwarded after the signal aborts or the call settles,
 * while the installed stack's download and proving run on until they end; an injected stack may stop on the signal.
 * A failed download is `device-unavailable`, except a zkey piece under `chunked`, whose error the peer drops: that proof
 * reads `material-rejected`, and the piece stays in the browser's storage under its file name until the site's data is cleared.
 */
export async function runProver(
  stack: AnonAadhaarStack,
  options: AadhaarArgsOptions,
  material: AadhaarMaterial,
): Promise<AadhaarPcd | ReplyFailure> {
  const { onProgress, signal } = material;
  const aborted = abortFailure(signal);

  if (aborted !== undefined) return aborted;

  let settled = false;
  const progress = gatedProgress(onProgress, signal, () => settled);

  try {
    const args = await untilSettled(stack.generateArgs(options), signal);

    if (isFailure(args)) return args;

    return await untilSettled(stack.prove(args, progress, signal), signal);
  } catch (error) {
    return failureOf(error);
  } finally {
    settled = true;
  }
}

export const isFailure = (value: unknown): value is ReplyFailure =>
  typeof value === 'object' && value !== null && (value as ReplyFailure).kind === METHOD_AADHAAR_MATERIAL_REJECTED.kind;

/**
 * The stack's proof in the proof layout, each `pi_b` pair swapped into the order
 * the verifier takes, or `undefined` for a hole or a value that is not a `uint256`.
 */
export function packProof(pcd: AadhaarPcd): AadhaarProof | undefined {
  const proof: unknown = pcd?.proof;

  if (typeof proof !== 'object' || proof === null) return undefined;

  const { groth16Proof: groth16, ...signals } = proof as { groth16Proof?: AadhaarGroth16; [name: string]: unknown };
  const rows = Array.isArray(groth16?.pi_b) ? groth16.pi_b : [];
  const a = parsePair(groth16?.pi_a);
  const b0 = Object.hasOwn(rows, 0) ? parsePair(rows[0]) : undefined;
  const b1 = Object.hasOwn(rows, 1) ? parsePair(rows[1]) : undefined;
  const c = parsePair(groth16?.pi_c);
  const inputs = parseWords(METHOD_AADHAAR_PUBLIC_INPUTS.map((name) => signals[name]), METHOD_AADHAAR_PUBLIC_INPUT_COUNT);

  if (a === undefined || b0 === undefined || b1 === undefined || c === undefined || inputs === undefined) return undefined;

  return {
    a,
    b: [
      [b0[1], b0[0]],
      [b1[1], b1[0]],
    ],
    c,
    inputs,
  };
}
