import {
  METHOD_AADHAAR_ARTIFACT_ORIGIN_MESSAGE,
  METHOD_AADHAAR_ARTIFACT_ORIGINS,
  METHOD_AADHAAR_ARTIFACT_URL_MESSAGE,
  METHOD_AADHAAR_CERTIFICATE_INPUT,
  METHOD_AADHAAR_CERTIFICATE_MESSAGE,
  METHOD_AADHAAR_CERTIFICATE_PARAM,
  METHOD_AADHAAR_FRESHNESS_WINDOW,
  METHOD_AADHAAR_MIN_FRESHNESS_WINDOW,
  METHOD_AADHAAR_SEED_PARAM,
  METHOD_AADHAAR_SEED_RANGE_MESSAGE,
  METHOD_AADHAAR_SEED_TYPE_MESSAGE,
  METHOD_AADHAAR_SIGNAL_CALLS,
  METHOD_AADHAAR_SIGNAL_FLAG,
  METHOD_AADHAAR_SNARK_SCALAR_FIELD,
  METHOD_AADHAAR_WORD_BITS,
} from '../constants/method-aadhaar';
import {
  METHOD_AADHAAR_WINDOW_PARAM,
  METHOD_AADHAAR_WINDOW_RANGE_MESSAGE,
  METHOD_AADHAAR_WINDOW_TYPE_MESSAGE,
} from '../constants/method-aadhaar-params';
import type { Input, Material, Params } from '../interfaces';
import type {
  AadhaarArgsOptions,
  AadhaarMaterial,
  AadhaarParams,
  AadhaarProgress,
  AnonAadhaarArtifacts,
} from '../types/method-aadhaar';

/** Whether a value is a non-null object whose members can be read by name. */
export const isRecord = (value: unknown): value is { readonly [name: string]: unknown } =>
  typeof value === 'object' && value !== null;

/** A safe integer as a bigint; any other value unchanged. */
const bigintOf = (value: unknown): unknown => (typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value);

/** Whether a seed enters the circuit unreduced. */
const inField = (seed: bigint): boolean => seed >= 0n && seed < METHOD_AADHAAR_SNARK_SCALAR_FIELD;

/** Whether a freshness window is at least the minimum and fits a `uint256`. */
const fitsWindow = (window: bigint): boolean =>
  window >= METHOD_AADHAAR_MIN_FRESHNESS_WINDOW && window < 1n << BigInt(METHOD_AADHAAR_WORD_BITS);

/** Whether a value is a bigint that fits a `uint256`. */
const isWord = (value: unknown): value is bigint => typeof value === 'bigint' && value >= 0n && value < 1n << BigInt(METHOD_AADHAAR_WORD_BITS);

function readSeed(value: unknown): bigint | undefined {
  const seed = bigintOf(value);

  return typeof seed === 'bigint' && inField(seed) ? seed : undefined;
}

const readCertificate = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
 * The seed and the certificate from the integrator's parameters: a `TypeError` for a seed that is
 * not an integer or an empty certificate, a `RangeError` for a seed outside the circuit's field.
 */
export function readParams(params: Params | undefined): AadhaarParams {
  const seed = bigintOf(params?.[METHOD_AADHAAR_SEED_PARAM]);
  const certificateFile = readCertificate(params?.[METHOD_AADHAAR_CERTIFICATE_PARAM]);

  if (typeof seed !== 'bigint') throw new TypeError(`${METHOD_AADHAAR_SEED_PARAM} ${METHOD_AADHAAR_SEED_TYPE_MESSAGE}`);

  if (!inField(seed)) throw new RangeError(`${METHOD_AADHAAR_SEED_PARAM} ${METHOD_AADHAAR_SEED_RANGE_MESSAGE}`);

  if (certificateFile === undefined) {
    throw new TypeError(`${METHOD_AADHAAR_CERTIFICATE_PARAM} ${METHOD_AADHAAR_CERTIFICATE_MESSAGE}`);
  }

  return { nullifierSeed: seed, certificateFile };
}

/** The seed, the certificate and any trusted key off an input this method returned, or `undefined` where one is malformed. */
export function readInput(input: Input | undefined): AadhaarParams | undefined {
  if (!isRecord(input)) return undefined;

  const nullifierSeed = readSeed(input[METHOD_AADHAAR_SEED_PARAM]);
  const certificateFile = readCertificate(input[METHOD_AADHAAR_CERTIFICATE_INPUT]);
  const { trustedKey } = input;

  if (nullifierSeed === undefined || certificateFile === undefined) return undefined;

  if (trustedKey === undefined) return { nullifierSeed, certificateFile };

  return isWord(trustedKey) ? { nullifierSeed, certificateFile, trustedKey } : undefined;
}

/**
 * The holder's freshness window from the enrollment parameters, `METHOD_AADHAAR_FRESHNESS_WINDOW` where they name none: a `TypeError`
 * for a value that is not a bigint or a safe integer, a `RangeError` for one under the minimum or outside a `uint256`.
 */
export function readWindow(params: Params | undefined): bigint {
  const window = bigintOf(params?.[METHOD_AADHAAR_WINDOW_PARAM]);

  if (window === undefined) return METHOD_AADHAAR_FRESHNESS_WINDOW;

  if (typeof window !== 'bigint') throw new TypeError(`${METHOD_AADHAAR_WINDOW_PARAM} ${METHOD_AADHAAR_WINDOW_TYPE_MESSAGE}`);

  if (!fitsWindow(window)) throw new RangeError(`${METHOD_AADHAAR_WINDOW_PARAM} ${METHOD_AADHAAR_WINDOW_RANGE_MESSAGE}`);

  return window;
}

/** The window off an enrollment input, the default where it carries none, or `undefined` for one that is not a bigint `readWindow` admits. */
export function readInputWindow(input: Input | undefined): bigint | undefined {
  const window = isRecord(input) ? input[METHOD_AADHAAR_WINDOW_PARAM] : undefined;

  if (window === undefined) return METHOD_AADHAAR_FRESHNESS_WINDOW;

  return typeof window === 'bigint' && fitsWindow(window) ? window : undefined;
}

/** Whether a value carries the signal members this module uses; a throwing getter means it does not. */
function isAbortSignal(value: unknown): value is AbortSignal {
  try {
    return (
      isRecord(value) &&
      typeof value[METHOD_AADHAAR_SIGNAL_FLAG] === 'boolean' &&
      METHOD_AADHAAR_SIGNAL_CALLS.every((name) => typeof value[name] === 'function')
    );
  } catch {
    return false;
  }
}

/** The material's members, each read once, or `undefined` when a getter throws. */
function readMembers(material: { readonly [name: string]: unknown }): [unknown, unknown, unknown] | undefined {
  try {
    const { qrData, onProgress, signal } = material;

    return [qrData, onProgress, signal];
  } catch {
    return undefined;
  }
}

/** The page's material, or `undefined` when it has another shape. */
export function readMaterial(material: Material): AadhaarMaterial | undefined {
  if (!isRecord(material)) return undefined;

  const members = readMembers(material);

  if (members === undefined) return undefined;

  const [qrData, onProgress, signal] = members;

  if (typeof qrData !== 'string' || qrData.trim() === '') return undefined;

  if (onProgress !== undefined && typeof onProgress !== 'function') return undefined;

  if (signal !== undefined && !isAbortSignal(signal)) return undefined;

  return { qrData, onProgress: onProgress as AadhaarProgress | undefined, signal };
}

/** The `generateArgs` options, revealing no fields; without a signal the stack applies its own default. */
export function argsOptions(params: AadhaarParams, qrData: string, signal?: string): AadhaarArgsOptions {
  const { certificateFile, nullifierSeed } = params;
  const base = { qrData, certificateFile, nullifierSeed, fieldsToRevealArray: [] };

  return signal === undefined ? base : { ...base, signal };
}

/** The artifacts' four members, copied by name so no other member reaches the stack. */
export function readArtifacts(artifacts: AnonAadhaarArtifacts): AnonAadhaarArtifacts {
  const { wasmURL, zkeyURL, vkeyURL, artifactsOrigin } = artifacts;
  const urls = [wasmURL, zkeyURL, vkeyURL];

  if (!urls.every((url) => typeof url === 'string' && url !== '')) {
    throw new TypeError(METHOD_AADHAAR_ARTIFACT_URL_MESSAGE);
  }

  if (!(METHOD_AADHAAR_ARTIFACT_ORIGINS as readonly unknown[]).includes(artifactsOrigin)) {
    throw new TypeError(`${METHOD_AADHAAR_ARTIFACT_ORIGIN_MESSAGE} ${METHOD_AADHAAR_ARTIFACT_ORIGINS.join(', ')}`);
  }

  return { wasmURL, zkeyURL, vkeyURL, artifactsOrigin };
}
