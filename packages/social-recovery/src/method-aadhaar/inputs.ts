import { METHOD_AADHAAR_SNARK_SCALAR_FIELD } from '../constants/method-aadhaar';
import type { Input, Material, Params } from '../interfaces';
import type { AadhaarArgsOptions, AadhaarMaterial, AadhaarParams, AadhaarProgress } from '../types';

const isRecord = (value: unknown): value is { readonly [name: string]: unknown } =>
  typeof value === 'object' && value !== null;

function readSeed(value: unknown): bigint | undefined {
  const seed = typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value;

  return typeof seed === 'bigint' && seed >= 0n && seed < METHOD_AADHAAR_SNARK_SCALAR_FIELD ? seed : undefined;
}

const readCertificate = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
 * The seed and the certificate from the integrator's parameters. Throws a
 * TypeError for a seed that is not an integer inside the circuit's field or an empty certificate.
 */
export function readParams(params: Params | undefined): AadhaarParams {
  const nullifierSeed = readSeed(params?.['nullifierSeed']);
  const certificateFile = readCertificate(params?.['issuerCertificate']);

  if (nullifierSeed === undefined) {
    throw new TypeError('nullifierSeed is not a non-negative integer below the circuit field');
  }

  if (certificateFile === undefined) throw new TypeError('issuerCertificate is not a non-empty PEM string');

  return { nullifierSeed, certificateFile };
}

/** The seed and the certificate off an input this method returned, or `undefined`. */
export function readInput(input: Input | undefined): AadhaarParams | undefined {
  if (!isRecord(input)) return undefined;

  const nullifierSeed = readSeed(input['nullifierSeed']);
  const certificateFile = readCertificate(input['certificateFile']);

  return nullifierSeed === undefined || certificateFile === undefined ? undefined : { nullifierSeed, certificateFile };
}

/** Whether a value carries the signal members this module uses; a throwing getter means it does not. */
function isAbortSignal(value: unknown): value is AbortSignal {
  try {
    return (
      isRecord(value) &&
      typeof value['aborted'] === 'boolean' &&
      typeof value['addEventListener'] === 'function' &&
      typeof value['removeEventListener'] === 'function'
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
